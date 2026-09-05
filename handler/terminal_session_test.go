package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
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
	wantCommand := fmt.Sprintf("tmux kill-session -t wt-%d-%d-fe257cc3cbdcf77f 2>/dev/null || true", userID, connectionID)
	if ranCommand != wantCommand {
		t.Fatalf("command = %q, want an idempotent, shell-safe kill scoped to the requested tab", ranCommand)
	}
}

func TestReleaseEnvironmentClosePreservesSharedTmuxSession(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("release-tester", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.CreateConnection(&store.Connection{
		Name: "terminal host", Host: "127.0.0.1", Port: 22, Username: "tester",
		AuthMethod: "password", CreatedBy: userID, MaxSessions: 30,
	})
	if err != nil {
		t.Fatal(err)
	}

	runCalled := false
	h := &WSHandler{
		Store:                    st,
		PreserveTerminalSessions: true,
		RunTerminalCommand: func(*store.Connection, string) error {
			runCalled = true
			return nil
		},
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/terminal-sessions/1?terminal_id=shared-tab", nil)
	req.SetPathValue("conn_id", "1")
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.CloseTerminalSession)).ServeHTTP(res, req)

	if res.Code != http.StatusOK || res.Body.String() != `{"status":"preserved"}` {
		t.Fatalf("close status = %d, body = %s", res.Code, res.Body.String())
	}
	if runCalled {
		t.Fatal("release-test close executed a remote tmux command")
	}
}
