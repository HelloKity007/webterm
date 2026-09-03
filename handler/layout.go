package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
	"golang.org/x/net/websocket"
)

const maxLayoutBytes = 256 * 1024

type LayoutHandler struct {
	Store *store.Store
	Hub   *LayoutHub
}

// HandleEvents sends revision-only notifications. The browser fetches the
// actual layout with its existing authorized GET request after an event.
func (h *LayoutHandler) HandleEvents(conn *websocket.Conn) {
	user := auth.GetUserWS(conn.Request())
	if user == nil || h.Hub == nil {
		_ = conn.Close()
		return
	}
	events, unsubscribe := h.Hub.Subscribe(user.UserID)
	defer unsubscribe()
	for revision := range events {
		if err := websocket.JSON.Send(conn, map[string]int64{"revision": revision}); err != nil {
			return
		}
	}
}

type savedLayout struct {
	Tree          layoutNode            `json:"tree"`
	Panes         map[string]layoutPane `json:"panes"`
	FocusedPaneID string                `json:"focusedPaneId"`
}

type layoutNode struct {
	Type      string       `json:"type"`
	ID        string       `json:"id"`
	Direction string       `json:"direction"`
	Children  []layoutNode `json:"children"`
	Ratios    []float64    `json:"ratios"`
}

type layoutPane struct {
	Tabs        []layoutTab `json:"tabs"`
	ActiveTabID string      `json:"activeTabId"`
}

type layoutTab struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Title  string `json:"title"`
	ConnID int64  `json:"connId"`
}

func (h *LayoutHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r)
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	layout, err := h.Store.GetUserLayout(user.UserID)
	if err != nil {
		http.Error(w, `{"error":"failed to load layout"}`, http.StatusInternalServerError)
		return
	}
	filtered, skipped := h.filterUnavailableTabs(user, layout.LayoutJSON)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"schema_version": layout.SchemaVersion, "revision": layout.Revision, "layout": json.RawMessage(filtered), "skipped_tabs": skipped})
}

func (h *LayoutHandler) Save(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r)
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxLayoutBytes)
	var request struct {
		SchemaVersion int             `json:"schema_version"`
		Revision      int64           `json:"revision"`
		Layout        json.RawMessage `json:"layout"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.SchemaVersion != 1 || len(request.Layout) == 0 || !validLayoutJSON(request.Layout) {
		http.Error(w, `{"error":"invalid layout"}`, http.StatusBadRequest)
		return
	}
	allowed, err := h.layoutConnectionsAreUsable(user, request.Layout)
	if err != nil {
		http.Error(w, `{"error":"failed to validate layout"}`, http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, `{"error":"layout references unavailable connection"}`, http.StatusForbidden)
		return
	}
	revision, err := h.Store.SaveUserLayout(user.UserID, request.SchemaVersion, request.Revision, request.Layout)
	if errors.Is(err, store.ErrLayoutConflict) {
		http.Error(w, `{"error":"layout revision conflict"}`, http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"failed to save layout"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if h.Hub != nil {
		h.Hub.Publish(user.UserID, revision)
	}
	json.NewEncoder(w).Encode(map[string]any{"revision": revision})
}

func validLayoutJSON(raw json.RawMessage) bool {
	var layout savedLayout
	if json.Unmarshal(raw, &layout) != nil || layout.Panes == nil {
		return false
	}
	leaves := make(map[string]struct{})
	if !validLayoutTree(layout.Tree, leaves) || len(leaves) != len(layout.Panes) {
		return false
	}
	for paneID, pane := range layout.Panes {
		if _, ok := leaves[paneID]; !ok || !validLayoutPane(pane) {
			return false
		}
	}
	_, focusExists := leaves[layout.FocusedPaneID]
	return layout.FocusedPaneID == "" || focusExists
}

func validLayoutTree(node layoutNode, leaves map[string]struct{}) bool {
	switch node.Type {
	case "leaf":
		if strings.TrimSpace(node.ID) == "" || len(node.Children) != 0 || len(node.Ratios) != 0 {
			return false
		}
		if _, duplicate := leaves[node.ID]; duplicate {
			return false
		}
		leaves[node.ID] = struct{}{}
		return true
	case "split":
		if node.Direction != "horizontal" && node.Direction != "vertical" || len(node.Children) < 2 || len(node.Children) != len(node.Ratios) {
			return false
		}
		for _, ratio := range node.Ratios {
			if ratio <= 0 {
				return false
			}
		}
		for _, child := range node.Children {
			if !validLayoutTree(child, leaves) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func validLayoutPane(pane layoutPane) bool {
	seen := make(map[string]struct{})
	activeFound := pane.ActiveTabID == ""
	for _, tab := range pane.Tabs {
		if strings.TrimSpace(tab.ID) == "" || strings.TrimSpace(tab.Title) == "" || tab.ConnID < 1 || (tab.Type != "ssh" && tab.Type != "database") {
			return false
		}
		if _, duplicate := seen[tab.ID]; duplicate {
			return false
		}
		seen[tab.ID] = struct{}{}
		activeFound = activeFound || tab.ID == pane.ActiveTabID
	}
	return activeFound
}

func (h *LayoutHandler) layoutConnectionsAreUsable(user *auth.Claims, raw json.RawMessage) (bool, error) {
	var layout savedLayout
	if err := json.Unmarshal(raw, &layout); err != nil {
		return false, err
	}
	for _, pane := range layout.Panes {
		for _, tab := range pane.Tabs {
			if tab.Type == "ssh" {
				connection, err := h.Store.GetConnection(tab.ConnID)
				if err != nil || !canUseConnection(user, connection) {
					return false, nil
				}
			} else {
				connection, err := h.Store.GetDbConnection(tab.ConnID)
				if err != nil || !canUseDbConnection(user, connection) {
					return false, nil
				}
			}
		}
	}
	return true, nil
}

func (h *LayoutHandler) filterUnavailableTabs(user *auth.Claims, raw json.RawMessage) ([]byte, int) {
	var layout savedLayout
	if json.Unmarshal(raw, &layout) != nil || !validLayoutJSON(raw) {
		return raw, 0
	}
	skipped := 0
	for paneID, pane := range layout.Panes {
		kept := pane.Tabs[:0]
		for _, tab := range pane.Tabs {
			allowed := false
			if tab.Type == "ssh" {
				connection, err := h.Store.GetConnection(tab.ConnID)
				allowed = err == nil && canUseConnection(user, connection)
			} else {
				connection, err := h.Store.GetDbConnection(tab.ConnID)
				allowed = err == nil && canUseDbConnection(user, connection)
			}
			if allowed {
				kept = append(kept, tab)
			} else {
				skipped++
			}
		}
		pane.Tabs = kept
		if pane.ActiveTabID != "" && !tabExists(kept, pane.ActiveTabID) {
			pane.ActiveTabID = ""
			if len(kept) > 0 {
				pane.ActiveTabID = kept[len(kept)-1].ID
			}
		}
		layout.Panes[paneID] = pane
	}
	encoded, err := json.Marshal(layout)
	if err != nil {
		return raw, 0
	}
	if skipped == 0 {
		return raw, 0
	}
	return encoded, skipped
}

func tabExists(tabs []layoutTab, id string) bool {
	for _, tab := range tabs {
		if tab.ID == id {
			return true
		}
	}
	return false
}
