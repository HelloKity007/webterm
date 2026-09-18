package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

// A physical-row capture turns soft wraps into irreversible CRLF on replay.
// Exercise the actual command against an isolated tmux server, not a mock of
// capture-pane, so removing logical-line preservation breaks this test.
func TestTerminalHistoryCapturePreservesLogicalWrappedLines(t *testing.T) {
	binary := os.Getenv("WEBTERM_QA_TMUX_BINARY")
	if binary == "" {
		var err error
		binary, err = exec.LookPath("tmux")
		if err != nil {
			t.Skip("tmux is required for the real capture integration test")
		}
	}
	socket := "webterm-history-wrap-" + strconv.Itoa(os.Getpid()) + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	longLine := "WRAP_BEGIN_" + strings.Repeat("X", 301) + "_WRAP_END"
	fixture := "printf '%s\\n' '" + longLine + "' 'SECOND_LOGICAL_LINE'; sleep 60"
	if output, err := exec.Command(binary, "-L", socket, "new-session", "-d", "-x", "103", "-y", "26", "-s", "fixture", fixture).CombinedOutput(); err != nil {
		t.Fatalf("start isolated tmux: %v: %s", err, output)
	}
	t.Cleanup(func() { _ = exec.Command(binary, "-L", socket, "kill-server").Run() })
	command := terminalHistoryCaptureCommand("fixture", socket, binary)
	deadline := time.Now().Add(3 * time.Second)
	for {
		capture, err := exec.Command("sh", "-c", command).CombinedOutput()
		if err != nil {
			t.Fatalf("capture: %v: %s", err, capture)
		}
		if strings.Contains(string(capture), "SECOND_LOGICAL_LINE") {
			replay := string(terminalCaptureBytes(capture))
			if !strings.Contains(replay, longLine+"\r\nSECOND_LOGICAL_LINE\r\n") {
				t.Fatalf("soft-wrapped line became hard breaks in replay: %q", replay)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("isolated fixture did not print its marker")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestTerminalSnapshotRestoresGridScreenAndCursor(t *testing.T) {
	got := string(terminalScreenSnapshot([]byte("first\nlast\n"), []string{"%4", "claude", "80", "2", "3", "1", "1"}))
	if !strings.HasPrefix(got, "\x1b]2;webterm-grid:80x2\x07\x1b[?1049h") {
		t.Fatalf("grid and alternate mode missing: %q", got)
	}
	if !strings.Contains(got, "\x1b[1;1Hfirst\x1b[2;1Hlast") {
		t.Fatalf("row positions incorrect: %q", got)
	}
	if strings.Contains(got, "\n") {
		t.Fatal("snapshot must not scroll the last row")
	}
	if !strings.HasSuffix(got, "\x1b[0m\x1b[2;4H") {
		t.Fatalf("cursor not restored: %q", got)
	}
}

func TestTerminalSnapshotRestoresActualPaneMouseProtocol(t *testing.T) {
	// Claude can remain quiet after attach, so no live DECSET need follow this
	// snapshot. Its already-enabled protocol must be restored with the screen.
	state := []string{"%4", "claude", "104", "40", "2", "35", "1", "0", "0", "1", "0", "1"}
	got := string(terminalScreenSnapshot([]byte("Jump to bottom\n"), state))
	if !strings.Contains(got, "\x1b[?1003h") || !strings.Contains(got, "\x1b[?1006h") {
		t.Fatalf("snapshot omitted pane's all-motion SGR mouse protocol: %q", got)
	}
	if !strings.Contains(got, "\x1b]2;webterm-grid:104x40\x07") {
		t.Fatal("extended pane metadata must not discard screen/grid restoration")
	}
}

func TestTerminalSnapshotDisablesMouseForPaneWithoutTracking(t *testing.T) {
	state := []string{"%4", "bash", "104", "40", "2", "35", "0", "0", "0", "0", "0", "0"}
	got := string(terminalScreenSnapshot([]byte("$ draft\n"), state))
	for _, mode := range []string{"1000", "1002", "1003", "1005", "1006"} {
		if !strings.Contains(got, "\x1b[?"+mode+"l") || strings.Contains(got, "\x1b[?"+mode+"h") {
			t.Fatalf("stale mouse mode %s not cleared for shell snapshot: %q", mode, got)
		}
	}
}

func TestTerminalCaptureReturnsEveryRowToFirstColumn(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"196\n197\n198\n", "196\r\n197\r\n198\r\n"},
		{"\x1b[32m中文\x1b[0m\n\nnext\n", "\x1b[32m中文\x1b[0m\r\n\r\nnext\r\n"},
		{"one\r\ntwo\n", "one\r\ntwo\r\n"},
		{"partial", "partial"},
	} {
		if got := string(terminalCaptureBytes([]byte(test.input))); got != test.want {
			t.Fatalf("snapshot=%q got=%q want=%q", test.input, got, test.want)
		}
	}
}

func TestShellSnapshotRetainsHistoryBeyondViewport(t *testing.T) {
	got := string(terminalScreenSnapshot([]byte("oldest\nmiddle\nlast\n"), []string{"%2", "bash", "80", "2", "4", "1", "0"}))
	if !strings.Contains(got, "oldest\r\nmiddle\r\nlast") {
		t.Fatalf("history truncated: %q", got)
	}
	if !strings.HasSuffix(got, "\x1b[0m\x1b[2;5H") {
		t.Fatalf("cursor not restored: %q", got)
	}
}

func TestInitialTerminalScreenCaptureNeverRequestsScrollback(t *testing.T) {
	got := initialTerminalScreenCaptureCommand("wt01-01-05-example", "qa-socket", "/opt/tmux")
	if strings.Contains(got, " -S ") {
		t.Fatalf("initial capture must not request shell scrollback: %q", got)
	}
	if !strings.Contains(got, "capture-pane -p -e -t wt01-01-05-example") {
		t.Fatalf("initial capture must target its visible pane: %q", got)
	}
}

func TestTerminalHistoryCaptureTargetsOnlyTheRequestedPanel(t *testing.T) {
	target, err := terminalHistoryCaptureTarget(1, 22, "ssh-2-panel-5", "1", "5")
	if err != nil {
		t.Fatal(err)
	}
	command := terminalHistoryCaptureCommand(target, "release-test", "/opt/tmux")
	if !strings.Contains(command, "/opt/tmux -L release-test capture-pane -p -e -J -S -2000 -t wt01-01-05-") {
		t.Fatalf("history capture command = %q", command)
	}
	if _, err := terminalHistoryCaptureTarget(1, 22, "shell", "one", "5"); err == nil {
		t.Fatal("non-numeric workspace must be rejected")
	}
}

func TestReplayTerminalHistoryCapturesTmuxOnlyOnExplicitRequest(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("history-owner", "hash", "user")
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
	var gotConnection int64
	var gotCommand string
	h := &WSHandler{
		Store: st, TmuxSocket: "release-test", TmuxBinary: "/opt/tmux",
		CaptureTerminalOutput: func(connection *store.Connection, command string) ([]byte, error) {
			gotConnection, gotCommand = connection.ID, command
			return []byte("older\ncurrent\n"), nil
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/terminal-history/1?terminal_id=ssh-2-panel-5&workspace_index=1&panel_number=5", nil)
	req.SetPathValue("conn_id", "1")
	req = auth.WithUser(req, &auth.Claims{UserID: userID, Role: "user"})
	res := httptest.NewRecorder()
	h.ReplayTerminalHistory(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if gotConnection != connectionID || !strings.Contains(gotCommand, "capture-pane -p -e -J -S -2000 -t wt01-01-05-") {
		t.Fatalf("capture target connection=%d command=%q", gotConnection, gotCommand)
	}
	var payload struct {
		Bytes int    `json:"bytes"`
		Data  string `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Bytes != len("older\r\ncurrent\r\n") || payload.Data == "" {
		t.Fatalf("unexpected payload=%+v", payload)
	}
}
