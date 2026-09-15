package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/xufanchn/webterm/auth"
)

// Keep a first wheel-up fast even for terminals that retain hundreds of
// thousands of tmux lines. This is a viewport bootstrap, not a full export;
// it deliberately contains many screens of recent context without recreating
// the multi-megabyte tab-switch replay this endpoint replaces.
const terminalHistoryReplayLines = 2_000

// ReplayTerminalHistory captures history only after a user explicitly asks to
// browse it. This keeps tab attachment cheap while allowing a newly attached
// xterm to recover the existing tmux scrollback on its first wheel-up.
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
	target, err := terminalHistoryCaptureTarget(user.UserID, connID, terminalID,
		r.URL.Query().Get("workspace_index"), r.URL.Query().Get("panel_number"))
	if err != nil {
		http.Error(w, `{"error":"invalid terminal history target"}`, http.StatusBadRequest)
		return
	}
	command := terminalHistoryCaptureCommand(target, h.TmuxSocket, h.TmuxBinary)
	snapshot, err := h.captureTerminalOutput(connection, command)
	if err == nil {
		// capture-pane is line-oriented, unlike the live PTY stream. Convert
		// LF to CRLF before returning it to xterm so every replayed history row
		// returns to column zero and contributes to normal-buffer scrollback.
		snapshot = terminalCaptureBytes(snapshot)
	} else {
		// A just-closed remote tmux session may still have transport output in
		// memory. It is a useful, bounded fallback but never replaces a live
		// tmux capture when one is available.
		snapshot = h.historyFor(terminalKeyFor(user.UserID, connID, terminalID)).snapshot()
		if len(snapshot) == 0 {
			http.Error(w, `{"error":"failed to capture terminal history"}`, http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":  "scrollback_replay",
		"data":  base64.StdEncoding.EncodeToString(snapshot),
		"b64":   true,
		"bytes": len(snapshot),
	})
}

func terminalHistoryCaptureTarget(userID, connectionID int64, terminalID, workspaceRaw, panelRaw string) (string, error) {
	target, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil || (workspaceRaw == "" && panelRaw == "") {
		return target, err
	}
	workspaceIndex, workspaceErr := strconv.ParseInt(workspaceRaw, 10, 64)
	panelNumber, panelErr := strconv.ParseInt(panelRaw, 10, 64)
	if workspaceErr != nil || panelErr != nil {
		return "", strconv.ErrSyntax
	}
	return persistentTerminalPanelSessionName(userID, workspaceIndex, panelNumber, terminalID)
}

func terminalHistoryCaptureCommand(targetName, socket, binary string) string {
	return scopeTmuxCommand("tmux capture-pane -p -e -S -"+strconv.Itoa(terminalHistoryReplayLines)+" -t "+targetName, socket, binary)
}

func terminalKeyFor(userID, connectionID int64, terminalID string) string {
	return strconv.FormatInt(userID, 10) + ":" + strconv.FormatInt(connectionID, 10) + ":" + terminalID
}
