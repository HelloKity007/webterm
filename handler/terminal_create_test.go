package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

func newTerminalCreateFixture(t *testing.T) (*store.Store, int64, int64) {
	t.Helper()
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("terminal-create-owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	connectionID, err := st.CreateConnection(&store.Connection{
		Name: "terminal create fixture", Host: "127.0.0.1", Port: 22, Username: "tester",
		AuthMethod: "password", CreatedBy: userID, MaxSessions: 30,
	})
	if err != nil {
		t.Fatal(err)
	}
	return st, userID, connectionID
}

func TestCreateTerminalSessionReservesCreatesAndActivatesExactIdentity(t *testing.T) {
	st, userID, connectionID := newTerminalCreateFixture(t)
	var command string
	h := &WSHandler{
		Store: st, Environment: "release-test", TmuxSocket: "webterm-release-test-fixed", TmuxBinary: "/opt/qa/tmux",
		RunTerminalCommand: func(_ *store.Connection, got string) error { command = got; return nil },
	}
	req := httptest.NewRequest(http.MethodPost, "/api/terminal-sessions/1", nil)
	req.SetPathValue("conn_id", "1")
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.CreateTerminalSession)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", res.Code, res.Body.String())
	}
	var response struct {
		TerminalID string `json:"terminal_id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil || !strings.HasPrefix(response.TerminalID, "terminal-") {
		t.Fatalf("invalid creation response %#v (%v)", response, err)
	}
	instance, err := st.GetTerminalInstance(userID, connectionID, response.TerminalID)
	if err != nil {
		t.Fatal(err)
	}
	if instance.State != store.TerminalActive || instance.Environment != "release-test" || instance.Socket != "webterm-release-test-fixed" || instance.Host != "127.0.0.1" || instance.SSHUser != "tester" {
		t.Fatalf("unexpected durable instance: %#v", instance)
	}
	for _, forbidden := range []string{"||", "has-session", "attach-session"} {
		if strings.Contains(command, forbidden) {
			t.Fatalf("explicit creator included an unsafe fallback %q: %s", forbidden, command)
		}
	}
	for _, required := range []string{"/opt/qa/tmux -L webterm-release-test-fixed new-session -d -s " + instance.CanonicalName, "@webterm_incarnation " + instance.Incarnation, "WEBTERM_CREATED:" + instance.Incarnation} {
		if !strings.Contains(command, required) {
			t.Fatalf("creation command missing %q: %s", required, command)
		}
	}
}

func TestCreateTerminalSessionAcknowledgementFailureLeavesReservedWithoutRetryAuthority(t *testing.T) {
	st, userID, _ := newTerminalCreateFixture(t)
	h := &WSHandler{
		Store: st, Environment: "release-test", TmuxSocket: "webterm-release-test-fixed",
		RunTerminalCommand: func(*store.Connection, string) error { return errTerminalCreateTransport },
	}
	req := httptest.NewRequest(http.MethodPost, "/api/terminal-sessions/1", nil)
	req.SetPathValue("conn_id", "1")
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.CreateTerminalSession)).ServeHTTP(res, req)
	if res.Code != http.StatusBadGateway || !strings.Contains(res.Body.String(), "TERMINAL_CREATE_UNCERTAIN") {
		t.Fatalf("uncertain create status=%d body=%s", res.Code, res.Body.String())
	}
	var state store.TerminalInstanceState
	if err := st.DB.QueryRow("SELECT state FROM terminal_instances WHERE user_id=?", userID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != store.TerminalReserved {
		t.Fatalf("uncertain remote acknowledgement changed durable state to %q", state)
	}
}

var errTerminalCreateTransport = &terminalCreateTestError{}

type terminalCreateTestError struct{}

func (*terminalCreateTestError) Error() string { return "simulated transport acknowledgement loss" }

func TestTerminalCreateAndVerificationCommandsHaveSeparatedAuthority(t *testing.T) {
	name := "wt-7-12-1234567890abcdef"
	incarnation := "11111111-1111-4111-8111-111111111111"
	create, err := terminalCreateCommand(name, incarnation)
	if err != nil {
		t.Fatal(err)
	}
	verify, err := terminalVerifyCreatedCommand(name, incarnation)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(create, "new-session") || strings.Contains(verify, "new-session") || !strings.Contains(verify, "tmux -N") {
		t.Fatalf("creation/verification authority is not separated: create=%q verify=%q", create, verify)
	}
}

func TestTerminalAdoptCommandCannotCreateOrStampExistingMarkedSession(t *testing.T) {
	command, err := terminalAdoptCommand("wt01-01-02-1234567890abcdef", "11111111-1111-4111-8111-111111111111")
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"new-session", "start-server", "||", "attach-session"} {
		if strings.Contains(command, forbidden) {
			t.Fatalf("legacy adoption has creation/attach fallback %q: %s", forbidden, command)
		}
	}
	for _, required := range []string{"tmux -N has-session", "if-shell -F", "@webterm_incarnation", "test \"$(tmux -N display-message"} {
		if !strings.Contains(command, required) {
			t.Fatalf("legacy adoption command missing %q: %s", required, command)
		}
	}
}

func TestAdoptTerminalSessionMarksOnlyExistingLegacyIdentity(t *testing.T) {
	st, userID, connectionID := newTerminalCreateFixture(t)
	var command string
	h := &WSHandler{
		Store: st, Environment: "release-test", TmuxSocket: "webterm-release-test-fixed",
		RunTerminalCommand: func(_ *store.Connection, got string) error { command = got; return nil },
	}
	req := httptest.NewRequest(http.MethodPost, "/api/terminal-sessions/1/adopt", strings.NewReader(`{"terminal_id":"legacy-panel","workspace_index":3,"panel_number":5}`))
	req.SetPathValue("conn_id", "1")
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.AdoptTerminalSession)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("adopt status=%d body=%s", res.Code, res.Body.String())
	}
	instance, err := st.GetTerminalInstance(userID, connectionID, "legacy-panel")
	if err != nil {
		t.Fatal(err)
	}
	if instance.State != store.TerminalActive || !strings.HasPrefix(instance.CanonicalName, "wt01-03-05-") || !strings.Contains(command, "-L webterm-release-test-fixed") {
		t.Fatalf("unexpected adoption state=%#v command=%s", instance, command)
	}
}

func TestAdoptTerminalSessionFailureKeepsReservationAndDoesNotCreate(t *testing.T) {
	st, userID, _ := newTerminalCreateFixture(t)
	var command string
	h := &WSHandler{
		Store: st, Environment: "release-test", TmuxSocket: "webterm-release-test-fixed",
		RunTerminalCommand: func(_ *store.Connection, got string) error { command = got; return errTerminalCreateTransport },
	}
	req := httptest.NewRequest(http.MethodPost, "/api/terminal-sessions/1/adopt", strings.NewReader(`{"terminal_id":"missing-legacy","workspace_index":1,"panel_number":2}`))
	req.SetPathValue("conn_id", "1")
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.AdoptTerminalSession)).ServeHTTP(res, req)
	if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "TERMINAL_ADOPTION_UNCERTAIN") || strings.Contains(command, "new-session") {
		t.Fatalf("missing adoption status=%d body=%s command=%s", res.Code, res.Body.String(), command)
	}
	var state store.TerminalInstanceState
	if err := st.DB.QueryRow("SELECT state FROM terminal_instances WHERE user_id=?", userID).Scan(&state); err != nil || state != store.TerminalReserved {
		t.Fatalf("missing adoption state=%q err=%v", state, err)
	}
}
