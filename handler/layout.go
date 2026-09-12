package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
	"golang.org/x/net/websocket"
)

const maxLayoutBytes = 256 * 1024

type LayoutHandler struct {
	Store    *store.Store
	Hub      *LayoutHub
	Registry *WSRegistry
}

// HandleEvents sends revision-only notifications. The browser fetches the
// actual layout with its existing authorized GET request after an event.
func (h *LayoutHandler) HandleEvents(conn *websocket.Conn) {
	conn.MaxPayloadBytes = maxWSInboundPayloadBytes
	user := auth.GetUserWS(conn.Request())
	if user == nil || h.Hub == nil {
		_ = conn.Close()
		return
	}
	outbound := newWSOutbound(conn, h.Registry)
	defer outbound.Close()
	events, unsubscribe := h.Hub.Subscribe(user.UserID)
	defer unsubscribe()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			var control struct {
				Action string `json:"action"`
			}
			if err := receiveWebSocketJSON(conn, &control); err != nil {
				return
			}
			if control.Action == "ping" {
				if err := outbound.Send(map[string]string{"type": "pong"}); err != nil {
					return
				}
			}
		}
	}()
	for {
		select {
		case <-done:
			return
		case revision, ok := <-events:
			if !ok || outbound.Send(map[string]int64{"revision": revision}) != nil {
				return
			}
		}
	}
}

type savedLayout struct {
	Tree          layoutNode            `json:"tree"`
	Panes         map[string]layoutPane `json:"panes"`
	FocusedPaneID string                `json:"focusedPaneId"`
}

type savedWorkspaceLayout struct {
	WorkspaceTabs []savedWorkspaceTab `json:"workspaceTabs"`
}

type savedWorkspaceTab struct {
	ID     string      `json:"id"`
	Index  int64       `json:"index"`
	Name   string      `json:"name"`
	Layout savedLayout `json:"layout"`
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
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	ConnID      int64  `json:"connId"`
	LabelNumber int64  `json:"labelNumber,omitempty"`
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
	filtered, skipped := h.filterUnavailableTabs(user, layout.SchemaVersion, layout.LayoutJSON)
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
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || (request.SchemaVersion != 1 && request.SchemaVersion != 2) || len(request.Layout) == 0 || !validLayoutJSON(request.SchemaVersion, request.Layout) {
		http.Error(w, `{"error":"invalid layout"}`, http.StatusBadRequest)
		return
	}
	allowed, err := h.layoutConnectionsAreUsable(user, request.SchemaVersion, request.Layout)
	if err != nil {
		http.Error(w, `{"error":"failed to validate layout"}`, http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, `{"error":"layout references unavailable connection"}`, http.StatusForbidden)
		return
	}
	sharedLayout, err := sharedLayoutJSON(request.SchemaVersion, request.Layout)
	if err != nil {
		http.Error(w, `{"error":"invalid layout"}`, http.StatusBadRequest)
		return
	}
	current, err := h.Store.GetUserLayout(user.UserID)
	if err != nil {
		http.Error(w, `{"error":"failed to load layout"}`, http.StatusInternalServerError)
		return
	}
	currentSharedLayout, err := sharedLayoutJSON(current.SchemaVersion, current.LayoutJSON)
	if current.Revision > 0 && current.Revision == request.Revision && current.SchemaVersion == request.SchemaVersion && err == nil && bytes.Equal(currentSharedLayout, sharedLayout) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"revision": current.Revision})
		return
	}
	revision, err := h.Store.SaveUserLayout(user.UserID, request.SchemaVersion, request.Revision, sharedLayout)
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

// sharedLayoutJSON deliberately removes browser-local selection state before
// it reaches the database or the layout event stream.  Only workspace shape
// and opened tabs are shared between a user's browsers.
func sharedLayoutJSON(schemaVersion int, raw json.RawMessage) ([]byte, error) {
	if schemaVersion == 1 {
		var layout savedLayout
		if err := json.Unmarshal(raw, &layout); err != nil {
			return nil, err
		}
		clearLocalLayoutState(&layout)
		return json.Marshal(layout)
	}
	if schemaVersion != 2 {
		return nil, errors.New("unsupported layout schema")
	}
	var layout savedWorkspaceLayout
	if err := json.Unmarshal(raw, &layout); err != nil {
		return nil, err
	}
	for index := range layout.WorkspaceTabs {
		clearLocalLayoutState(&layout.WorkspaceTabs[index].Layout)
	}
	return json.Marshal(layout)
}

func clearLocalLayoutState(layout *savedLayout) {
	layout.FocusedPaneID = ""
	for paneID, pane := range layout.Panes {
		pane.ActiveTabID = ""
		layout.Panes[paneID] = pane
	}
}

func validLayoutJSON(schemaVersion int, raw json.RawMessage) bool {
	if schemaVersion == 1 {
		var layout savedLayout
		return json.Unmarshal(raw, &layout) == nil && validSavedLayout(layout)
	}
	if schemaVersion != 2 {
		return false
	}
	var layout savedWorkspaceLayout
	if json.Unmarshal(raw, &layout) != nil || len(layout.WorkspaceTabs) == 0 {
		return false
	}
	workspaceIDs := make(map[string]struct{}, len(layout.WorkspaceTabs))
	workspaceIndexes := make(map[int64]struct{}, len(layout.WorkspaceTabs))
	paneIDs := make(map[string]struct{})
	terminalIDs := make(map[string]struct{})
	for _, workspace := range layout.WorkspaceTabs {
		if strings.TrimSpace(workspace.ID) == "" || workspace.Index < 1 || strings.TrimSpace(workspace.Name) == "" || utf8.RuneCountInString(workspace.Name) > 256 {
			return false
		}
		if _, duplicate := workspaceIDs[workspace.ID]; duplicate {
			return false
		}
		if _, duplicate := workspaceIndexes[workspace.Index]; duplicate {
			return false
		}
		workspaceIDs[workspace.ID] = struct{}{}
		workspaceIndexes[workspace.Index] = struct{}{}
		if !validSavedLayout(workspace.Layout) {
			return false
		}
		for paneID, pane := range workspace.Layout.Panes {
			if _, duplicate := paneIDs[paneID]; duplicate {
				return false
			}
			paneIDs[paneID] = struct{}{}
			for _, tab := range pane.Tabs {
				if _, duplicate := terminalIDs[tab.ID]; duplicate {
					return false
				}
				terminalIDs[tab.ID] = struct{}{}
			}
		}
	}
	return true
}

func validSavedLayout(layout savedLayout) bool {
	if layout.Panes == nil {
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
		if strings.TrimSpace(tab.ID) == "" || strings.TrimSpace(tab.Title) == "" || tab.ConnID < 1 || tab.LabelNumber < 0 || (tab.Type != "ssh" && tab.Type != "database") {
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

func (h *LayoutHandler) layoutConnectionsAreUsable(user *auth.Claims, schemaVersion int, raw json.RawMessage) (bool, error) {
	layouts, err := decodeSavedLayouts(schemaVersion, raw)
	if err != nil {
		return false, err
	}
	for _, layout := range layouts {
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
	}
	return true, nil
}

func decodeSavedLayouts(schemaVersion int, raw json.RawMessage) ([]savedLayout, error) {
	if schemaVersion == 1 {
		var layout savedLayout
		if err := json.Unmarshal(raw, &layout); err != nil {
			return nil, err
		}
		return []savedLayout{layout}, nil
	}
	if schemaVersion != 2 {
		return nil, errors.New("unsupported layout schema")
	}
	var workspaceLayout savedWorkspaceLayout
	if err := json.Unmarshal(raw, &workspaceLayout); err != nil {
		return nil, err
	}
	layouts := make([]savedLayout, 0, len(workspaceLayout.WorkspaceTabs))
	for _, workspace := range workspaceLayout.WorkspaceTabs {
		layouts = append(layouts, workspace.Layout)
	}
	return layouts, nil
}

func (h *LayoutHandler) filterUnavailableTabs(user *auth.Claims, schemaVersion int, raw json.RawMessage) ([]byte, int) {
	if !validLayoutJSON(schemaVersion, raw) {
		return raw, 0
	}
	if schemaVersion == 1 {
		var layout savedLayout
		if json.Unmarshal(raw, &layout) != nil {
			return raw, 0
		}
		skipped := h.filterSavedLayoutTabs(user, &layout)
		if skipped == 0 {
			return raw, 0
		}
		encoded, err := json.Marshal(layout)
		if err != nil {
			return raw, 0
		}
		return encoded, skipped
	}
	var layout savedWorkspaceLayout
	if json.Unmarshal(raw, &layout) != nil {
		return raw, 0
	}
	skipped := 0
	for index := range layout.WorkspaceTabs {
		skipped += h.filterSavedLayoutTabs(user, &layout.WorkspaceTabs[index].Layout)
	}
	if skipped == 0 {
		return raw, 0
	}
	encoded, err := json.Marshal(layout)
	if err != nil {
		return raw, 0
	}
	return encoded, skipped
}

func (h *LayoutHandler) filterSavedLayoutTabs(user *auth.Claims, layout *savedLayout) int {
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
	return skipped
}

func tabExists(tabs []layoutTab, id string) bool {
	for _, tab := range tabs {
		if tab.ID == id {
			return true
		}
	}
	return false
}
