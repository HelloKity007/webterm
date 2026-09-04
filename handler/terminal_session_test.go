package handler

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

func TestCloseTerminalSessionKillsOnlyTheRequestedTabsTmuxSession(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("terminal-owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	connectionID, err := st.CreateConnection(&store.Connection{
		Name: "terminal host", Host: "127.0.0.1", Port: 22, Username: "tester",
		AuthMethod: "password", CreatedBy: userID, MaxSessions: 30,
	})
	if err != nil {
		t.Fatal(err)
	}

	var ranForConnection int64
	var ranCommand string
	h := &WSHandler{
		Store: st,
		RunTerminalCommand: func(connection *store.Connection, command string) error {
			ranForConnection = connection.ID
			ranCommand = command
			return nil
		},
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/terminal-sessions/1?terminal_id=ssh-1-pane-a%3B+rm+-rf+%2F", nil)
	req.SetPathValue("conn_id", "1")
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.CloseTerminalSession)).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("close status = %d, body = %s", res.Code, res.Body.String())
	}
	if ranForConnection != connectionID {
		t.Fatalf("command connection = %d, want %d", ranForConnection, connectionID)
	}
	if !regexp.MustCompile(`^tmux kill-session -t wt-[0-9]+-[0-9]+-[a-f0-9]{16} 2>/dev/null \|\| true$`).MatchString(ranCommand) {
		t.Fatalf("command = %q, want an idempotent, shell-safe kill scoped to the requested tab", ranCommand)
	}
}
