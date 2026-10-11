package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/sshmgr"
	"github.com/xufanchn/webterm/store"
)

type terminalBackendFault struct {
	Code      string `json:"code,omitempty"`
	Message   string `json:"error,omitempty"`
	Retryable bool   `json:"retryable"`
}

// Successful shell framing distinguishes tmux failures from SSH failure. -N
// forbids creating a server, even when its socket has disappeared.
func terminalBackendProbeCommand(socket, binary string) string {
	return "LC_ALL=C; export LC_ALL; " + scopeTmuxCommand("tmux -N list-sessions -F '#{session_name}|#{@webterm_incarnation}'", socket, binary) + " 2>&1; printf '\\nWEBTERM_PROBE_EXIT:%s\\n' \"$?\""
}

func classifyTerminalBackend(output []byte, err error, instance *store.TerminalInstance) terminalBackendFault {
	unknown := terminalBackendFault{Code: "TERMINAL_BACKEND_UNREACHABLE", Message: "无法检查终端后端，可能是连接或权限问题；尚未确认会话丢失", Retryable: true}
	if err != nil {
		return unknown
	}
	text := strings.TrimSpace(string(output))
	split := strings.LastIndex(text, "\nWEBTERM_PROBE_EXIT:")
	if split < 0 {
		return unknown
	}
	body, status := strings.TrimSpace(text[:split]), text[split+len("\nWEBTERM_PROBE_EXIT:"):]
	if status != "0" {
		if strings.HasPrefix(body, "no server running on ") ||
			(strings.HasPrefix(body, "error connecting to ") && (strings.HasSuffix(body, "(No such file or directory)") || strings.HasSuffix(body, "(Connection refused)"))) {
			return terminalBackendFault{Code: "TERMINAL_SERVER_UNAVAILABLE", Message: "终端服务不可达：服务可能已退出，或连接文件丢失。已停止自动重连，请检查后重试"}
		}
		return unknown
	}
	for _, line := range strings.Split(body, "\n") {
		fields := strings.SplitN(line, "|", 2)
		if len(fields) != 2 {
			return unknown
		}
		if fields[0] == instance.CanonicalName {
			if fields[1] == instance.Incarnation {
				return terminalBackendFault{}
			}
			return terminalBackendFault{Code: "TERMINAL_IDENTITY_MISMATCH", Message: "终端身份已改变；为避免连接到其他会话，已停止连接"}
		}
	}
	return terminalBackendFault{Code: "TERMINAL_SESSION_MISSING", Message: "终端服务仍在，但原会话已不存在；新建终端不会恢复原进程"}
}

func probeTerminalBackend(client *sshmgr.Client, instance *store.TerminalInstance, socket, binary string) terminalBackendFault {
	session, err := client.NewSession()
	if err != nil {
		return classifyTerminalBackend(nil, err, instance)
	}
	defer session.Close()
	timer := time.AfterFunc(3*time.Second, func() { _ = session.Close() })
	defer timer.Stop()
	output := newTerminalHistory(64 * 1024)
	session.Stdout, session.Stderr = output, output
	err = session.Run(terminalBackendProbeCommand(socket, binary))
	return classifyTerminalBackend(output.snapshot(), err, instance)
}

func (h *WSHandler) sendTerminalFault(outbound *wsOutbound, instance *store.TerminalInstance, fault terminalBackendFault) {
	observed := time.Now().UTC().Format(time.RFC3339)
	// No tokens, input, screen text, or SSH credentials enter the event.
	event := map[string]any{"event": "terminal_backend_fault", "environment": h.terminalEnvironment(), "connection_id": instance.ConnectionID, "terminal_id": instance.TerminalID, "code": fault.Code, "observed_at": observed}
	encoded, _ := json.Marshal(event)
	log.Print(string(encoded))
	_ = outbound.Send(map[string]any{"type": "error", "code": fault.Code, "error": fault.Message, "retryable": fault.Retryable, "environment": h.terminalEnvironment(), "observed_at": observed})
}

// Application liveness and terminal readiness are separate: this authenticated
// endpoint checks precisely the requested, authorized durable identity.
func (h *WSHandler) TerminalHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user := auth.GetUser(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("conn_id"), 10, 64)
	if err != nil || id < 1 {
		http.Error(w, "invalid connection", http.StatusBadRequest)
		return
	}
	connection, err := h.Store.GetConnection(id)
	if err != nil {
		http.Error(w, "connection not found", http.StatusNotFound)
		return
	}
	if !canUseConnection(user, connection) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	instance, err := h.verifiedTerminalInstance(user.UserID, id, r.URL.Query().Get("terminal_id"), connection)
	if err != nil {
		http.Error(w, `{"code":"TERMINAL_IDENTITY_UNAVAILABLE"}`, http.StatusConflict)
		return
	}
	socket, binary := h.terminalTransport(instance)
	output, err := h.captureTerminalOutput(connection, terminalBackendProbeCommand(socket, binary))
	fault := classifyTerminalBackend(output, err, instance)
	status := "ready"
	if fault.Code != "" {
		status = "unavailable"
	}
	w.Header().Set("Content-Type", "application/json")
	if fault.Code != "" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "scope": "terminal", "terminal_id": instance.TerminalID, "observed_at": time.Now().UTC().Format(time.RFC3339), "fault": fault})
}
