package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

func TestTerminalIsolationConfigurationAndAuthority(t *testing.T) {
	for _, directory := range []string{"/tmp/webterm-production", "/run/webterm-production", "/home/a/../webterm-production", "/home/a/webterm-release-test", "/home/a/webterm-production;id", "/" + strings.Repeat("x", 80) + "/webterm-production"} {
		if ValidateTerminalIsolation("production", directory, "/opt/tmux") == nil {
			t.Fatalf("accepted %q", directory)
		}
	}
	if err := ValidateTerminalIsolation("production", "/home/a/webterm-production", "/opt/tmux"); err != nil {
		t.Fatal(err)
	}
	h := &WSHandler{Environment: "production", TmuxSocket: "webterm-production-durable", TmuxBinary: "/opt/legacy", TmuxSessionDirectory: "/home/a/webterm-production", TmuxSessionBinary: "/opt/current"}
	connection := &store.Connection{Host: "host", Port: 22, Username: "owner"}
	instance := &store.TerminalInstance{UserID: 1, ConnectionID: 2, TerminalID: "terminal-a", Environment: "production", Host: "host", Port: 22, SSHUser: "owner", CanonicalName: "session_a", Incarnation: guardTestIncarnation}
	instance.Socket = h.isolatedTerminalSocket(1, 2, "terminal-a")
	if !h.terminalInstanceMatchesEndpoint(instance, connection) {
		t.Fatal("own isolated socket rejected")
	}
	if s, b := h.terminalTransport(instance); s != instance.Socket || b != "/opt/current" {
		t.Fatal("wrong isolated transport")
	}
	instance.TerminalID = "terminal-b"
	if h.terminalInstanceMatchesEndpoint(instance, connection) {
		t.Fatal("accepted another terminal's socket")
	}
	instance.Socket = "webterm-production-durable"
	if !h.terminalInstanceMatchesEndpoint(instance, connection) {
		t.Fatal("legacy endpoint lost")
	}
	if _, b := h.terminalTransport(instance); b != "/opt/legacy" {
		t.Fatal("legacy client changed")
	}
}

func TestTerminalBackendDiagnosis(t *testing.T) {
	instance := &store.TerminalInstance{CanonicalName: "original", Incarnation: guardTestIncarnation}
	for _, test := range []struct {
		body, code string
		retry      bool
	}{
		{"original|" + guardTestIncarnation + "\n\nWEBTERM_PROBE_EXIT:0\n", "", false},
		{"other|" + guardTestIncarnation + "\n\nWEBTERM_PROBE_EXIT:0\n", "TERMINAL_SESSION_MISSING", false},
		{"original|wrong\n\nWEBTERM_PROBE_EXIT:0\n", "TERMINAL_IDENTITY_MISMATCH", false},
		{"no server running on /home/a/socket\n\nWEBTERM_PROBE_EXIT:1\n", "TERMINAL_SERVER_UNAVAILABLE", false},
		{"error connecting to /home/a/socket (No such file or directory)\n\nWEBTERM_PROBE_EXIT:1\n", "TERMINAL_SERVER_UNAVAILABLE", false},
		{"error connecting to /home/a/socket (Permission denied)\n\nWEBTERM_PROBE_EXIT:1\n", "TERMINAL_BACKEND_UNREACHABLE", true},
		{"truncated", "TERMINAL_BACKEND_UNREACHABLE", true},
		{"original_" + guardTestIncarnation + "\n\nWEBTERM_PROBE_EXIT:0\n", "TERMINAL_BACKEND_UNREACHABLE", true},
	} {
		got := classifyTerminalBackend([]byte(test.body), nil, instance)
		if got.Code != test.code || got.Retryable != test.retry {
			t.Fatalf("%q => %+v", test.body, got)
		}
	}
}

func TestTerminalHealthAuthorizationAndReadiness(t *testing.T) {
	st, userID, connID := newTerminalCreateFixture(t)
	h := &WSHandler{Store: st, Environment: "release-test", TmuxSocket: "webterm-release-test-fixed"}
	instance, _, err := st.ReserveTerminalInstance(store.TerminalInstance{UserID: userID, ConnectionID: connID, TerminalID: "terminal-health", Environment: "release-test", Host: "127.0.0.1", Port: 22, SSHUser: "tester", Socket: h.TmuxSocket, CanonicalName: "health"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CompareAndSwapTerminalInstanceState(userID, connID, instance.TerminalID, instance.Incarnation, store.TerminalReserved, store.TerminalActive); err != nil {
		t.Fatal(err)
	}
	calls := 0
	h.CaptureTerminalOutput = func(_ *store.Connection, command string) ([]byte, error) {
		calls++
		if !strings.Contains(command, "-N list-sessions") {
			t.Fatalf("not observational: %s", command)
		}
		return []byte("no server running on /private/socket\n\nWEBTERM_PROBE_EXIT:1\n"), nil
	}
	req := httptest.NewRequest("GET", "/api/terminal-health/1?terminal_id=terminal-health", nil)
	req.SetPathValue("conn_id", strconv.FormatInt(connID, 10))
	res := httptest.NewRecorder()
	h.TerminalHealth(res, req)
	if res.Code != 401 || calls != 0 {
		t.Fatal("unauthorized probe")
	}
	req = auth.WithUser(req, &auth.Claims{UserID: userID + 1, Role: "user"})
	res = httptest.NewRecorder()
	h.TerminalHealth(res, req)
	if res.Code != 403 || calls != 0 {
		t.Fatal("cross-owner probe")
	}
	req = auth.WithUser(req, &auth.Claims{UserID: userID, Role: "user"})
	res = httptest.NewRecorder()
	h.TerminalHealth(res, req)
	if res.Code != http.StatusServiceUnavailable || calls != 1 || !strings.Contains(res.Body.String(), "TERMINAL_SERVER_UNAVAILABLE") {
		t.Fatalf("%d %s", res.Code, res.Body.String())
	}
}

func TestIsolatedTerminalServerLossDoesNotAffectPeer(t *testing.T) {
	binary, err := filepath.Abs("../runtime/tmux-fixed/bin/tmux")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(binary); err != nil {
		binary, err = exec.LookPath("tmux")
		if err != nil {
			t.Skip("tmux unavailable")
		}
	}
	directory, err := os.MkdirTemp("", "wtiso-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	h := &WSHandler{Environment: "release-test", TmuxSessionDirectory: directory, TmuxSessionBinary: binary}
	run := func(command string) []byte {
		t.Helper()
		out, err := exec.Command("sh", "-c", command).CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %v: %s", command, err, out)
		}
		return out
	}
	instances := []*store.TerminalInstance{}
	for i := 1; i <= 2; i++ {
		instance := &store.TerminalInstance{UserID: 1, ConnectionID: 2, TerminalID: fmt.Sprintf("fixture-%d", i), CanonicalName: fmt.Sprintf("fixture%d", i), Incarnation: guardTestIncarnation}
		instance.Socket = h.isolatedTerminalSocket(1, 2, instance.TerminalID)
		// t.TempDir may exceed the UNIX socket limit on some runners.
		if len(instance.Socket) > 100 {
			t.Skip("test temporary socket path too long")
		}
		command, err := terminalCreateCommand(instance.CanonicalName, instance.Incarnation)
		if err != nil {
			t.Fatal(err)
		}
		run(h.scopeTerminalCreation(command, instance))
		t.Cleanup(func() { _ = exec.Command(binary, "-N", "-S", instance.Socket, "kill-server").Run() })
		options := strings.TrimSpace(string(run(scopeTmuxCommand("tmux -N display-message -p -t ="+instance.CanonicalName+": '#{history_limit}|#{window-size}|#{status}|#{mouse}|#{exit-unattached}'", instance.Socket, binary))))
		if options != "200000|largest|off|1|0" {
			t.Fatalf("isolated server options: %q", options)
		}
		instances = append(instances, instance)
	}
	inventory := func(instance *store.TerminalInstance) string {
		return strings.TrimSpace(string(run(scopeTmuxCommand("tmux -N display-message -p -t ="+instance.CanonicalName+": '#{pid} #{pane_pid} #{session_id} #{@webterm_incarnation}'", instance.Socket, binary))))
	}
	for _, instance := range instances {
		output := run(terminalBackendProbeCommand(instance.Socket, binary))
		if fault := classifyTerminalBackend(output, nil, instance); fault.Code != "" {
			t.Fatalf("healthy server misclassified: %+v raw=%q", fault, output)
		}
	}
	before := inventory(instances[1])
	first := inventory(instances[0])
	pid, err := strconv.Atoi(strings.Fields(first)[0])
	if err != nil {
		t.Fatal(err)
	}
	// Only this test-created private server is signalled; no production names.
	if err := syscall.Kill(pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	output := run(terminalBackendProbeCommand(instances[0].Socket, binary))
	fault := classifyTerminalBackend(output, nil, instances[0])
	if fault.Code != "TERMINAL_SERVER_UNAVAILABLE" {
		t.Fatalf("crashed server: %+v", fault)
	}
	if after := inventory(instances[1]); after != before {
		t.Fatalf("peer identity changed: %s => %s", before, after)
	}
	// Repeated probes must not recreate the killed server.
	for i := 0; i < 3; i++ {
		if f := classifyTerminalBackend(run(terminalBackendProbeCommand(instances[0].Socket, binary)), nil, instances[0]); f.Code != "TERMINAL_SERVER_UNAVAILABLE" {
			t.Fatal(f)
		}
	}
}

func TestIsolatedHistoryAndCloseUseRegisteredEndpoint(t *testing.T) {
	st, userID, connID := newTerminalCreateFixture(t)
	h := &WSHandler{Store: st, Environment: "release-test", TmuxSocket: "webterm-release-test-fixed", TmuxBinary: "/opt/legacy", TmuxSessionDirectory: "/home/test/webterm-release-test", TmuxSessionBinary: "/opt/isolated"}
	id := "terminal-saved-identity"
	socket := h.isolatedTerminalSocket(userID, connID, id)
	reserveActiveTerminalForClose(t, st, userID, connID, id, "release-test", socket)
	instance, err := st.GetTerminalInstance(userID, connID, id)
	if err != nil {
		t.Fatal(err)
	}
	check := func(command string) {
		t.Helper()
		if !strings.Contains(command, "/opt/isolated -S "+socket) || !strings.Contains(command, instance.CanonicalName) || strings.Contains(command, "/opt/legacy") || strings.Contains(command, "wt01-99-") {
			t.Fatalf("wrong endpoint: %s", command)
		}
	}
	h.CaptureTerminalOutput = func(_ *store.Connection, command string) ([]byte, error) {
		check(command)
		return []byte("history"), nil
	}
	// Changing presentation coordinates must never select a different backend.
	req := httptest.NewRequest("GET", "/api/terminal-history/1?terminal_id="+id+"&workspace_index=99&panel_number=98", nil)
	req.SetPathValue("conn_id", strconv.FormatInt(connID, 10))
	req = auth.WithUser(req, &auth.Claims{UserID: userID, Role: "user"})
	res := httptest.NewRecorder()
	h.ReplayTerminalHistory(res, req)
	if res.Code != 200 {
		t.Fatalf("history: %d %s", res.Code, res.Body.String())
	}
	h.RunTerminalCommand = func(_ *store.Connection, command string) error { check(command); return nil }
	req = httptest.NewRequest("DELETE", "/api/terminal-sessions/1?terminal_id="+id, nil)
	req.SetPathValue("conn_id", strconv.FormatInt(connID, 10))
	req = auth.WithUser(req, &auth.Claims{UserID: userID, Role: "user"})
	res = httptest.NewRecorder()
	h.CloseTerminalSession(res, req)
	if res.Code != 200 {
		t.Fatalf("close: %d %s", res.Code, res.Body.String())
	}
	instance, err = st.GetTerminalInstance(userID, connID, id)
	if err != nil || instance.State != store.TerminalClosed {
		t.Fatalf("close lifecycle: %+v %v", instance, err)
	}
}
