package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/xufanchn/webterm/auth"
)

// ReplayTerminalHistory returns the bounded byte transcript for a persistent
// terminal. It is intentionally an authenticated HTTP control-plane endpoint;
// the data plane remains the existing SSH WebSocket. A future Claude
// Control-Mode client can request this before opening its own viewport.
func (h *WSHandler) ReplayTerminalHistory(w http.ResponseWriter, r *http.Request) {
	connID, err := strconv.ParseInt(r.PathValue("conn_id"), 10, 64)
	if err != nil || connID < 1 {
		http.Error(w, `{"error":"invalid connection"}`, http.StatusBadRequest)
		return
	}
	user := auth.GetUser(r)
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	connection, err := h.Store.GetConnection(connID)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if !canUseConnection(user, connection) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	terminalID := r.URL.Query().Get("terminal_id")
	if terminalID == "" {
		http.Error(w, `{"error":"terminal_id is required"}`, http.StatusBadRequest)
		return
	}
	key := terminalKeyFor(user.UserID, connID, terminalID)
	snapshot := h.historyFor(key).snapshot()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":  "scrollback_replay",
		"data":  base64.StdEncoding.EncodeToString(snapshot),
		"b64":   true,
		"bytes": len(snapshot),
	})
}

func terminalKeyFor(userID, connectionID int64, terminalID string) string {
	return strconv.FormatInt(userID, 10) + ":" + strconv.FormatInt(connectionID, 10) + ":" + terminalID
}
