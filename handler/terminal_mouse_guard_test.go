package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestMouseGuardPreservesOrdinaryInput(t *testing.T) {
	for _, data := range []string{"hello 中文", "\r", "\x03", "\x1b[A", "35;31;31M", "\x1b[200~\x1b[<35;31;31M\x1b[201~", "printf ok\n"} {
		var out bytes.Buffer
		in := &tmuxControlInput{tracker: &tmuxControlPaneTracker{pane: "%3"}, writer: &out, mouseResetMarker: "WEBTERM_MOUSE_RESET:test"}
		n, err := in.Write([]byte(data))
		if err != nil || n != len(data) || out.String() != encodeTmuxControlSendKeys("%3", data) {
			t.Fatalf("input changed %q: %q %v", data, out.String(), err)
		}
	}
	for _, data := range []string{"\x1b[<35;31;31M", "\x1b[<0;1;2m", "\x1b[<64;31;19M\x1b[<65;31;19M"} {
		var out bytes.Buffer
		in := &tmuxControlInput{tracker: &tmuxControlPaneTracker{pane: "%3"}, writer: &out, mouseResetMarker: "WEBTERM_MOUSE_RESET:test"}
		if _, err := in.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(out.String(), "if-shell -F -t %3 ") {
			t.Fatal(out.String())
		}
	}
}

func TestMouseGuardResponseRequiresExactCompletedFrame(t *testing.T) {
	for _, lines := range [][]string{
		{"%output %1 WEBTERM_MOUSE_RESET:test"},
		{"%begin 1 2 0", "WEBTERM_MOUSE_RESET:test", "%error 1 2 0"},
		{"%begin 1 2 0", "WEBTERM_MOUSE_RESET:wrong", "%end 1 2 0"},
		{"%begin 1 2 0", "WEBTERM_MOUSE_RESET:test", "%end 1 3 0"},
	} {
		g := terminalMouseGuardResponse{marker: "WEBTERM_MOUSE_RESET:test"}
		for _, line := range lines {
			if g.observe(line) {
				t.Fatal("accepted", lines)
			}
		}
	}
	g := terminalMouseGuardResponse{marker: "WEBTERM_MOUSE_RESET:test"}
	if g.observe("%begin 1 2 0") || g.observe(g.marker) || !g.observe("%end 1 2 0") {
		t.Fatal("valid ack failed")
	}
}

func TestReconnectDoesNotRestoreDeadCLIMouseModeToShell(t *testing.T) {
	state := []string{"%1", "bash", "80", "24", "0", "0", "1", "0", "0", "1", "0", "1"}
	got := string(terminalScreenSnapshot([]byte("existing draft"), state))
	if strings.Contains(got, "\x1b[?1003h") || strings.Contains(got, "\x1b[?1006h") || !strings.Contains(got, "existing draft") {
		t.Fatal("stale shell mouse restored or draft lost")
	}
	state[1] = "claude"
	got = string(terminalScreenSnapshot([]byte("CLI"), state))
	if !strings.Contains(got, "\x1b[?1003h") || !strings.Contains(got, "\x1b[?1006h") {
		t.Fatal("live CLI mouse was disabled")
	}
}

func TestMouseRecoveryFollowsCLIExitAndReentry(t *testing.T) {
	// This is the exact state transition seen after a Claude/Codex process is
	// killed by its container: tmux keeps the DEC mouse flags, but Bash is the
	// foreground process again. The asynchronous output-triggered probe must
	// remove those flags without waiting for the next browser mouse event.
	shell := []string{"%1", "bash", "80", "24", "0", "0", "0", "0", "0", "1", "0", "1"}
	reset, mode := terminalMouseRecoveryForPane(shell)
	if mode != "shell" || string(reset) != terminalMouseDisable {
		t.Fatalf("shell recovery = %q, %q", reset, mode)
	}
	if got := string(terminalMouseProtocolForPane(shell)); got != terminalMouseDisable {
		t.Fatalf("shell protocol = %q", got)
	}

	// A later direct CLI invocation must remain eligible for its actual mouse
	// modes. It is the CLI's own DECSET output that re-enables xterm, not a
	// stale shell flag guessed by the server.
	for _, command := range []string{"claude", "codex"} {
		cli := append([]string(nil), shell...)
		cli[1], cli[9], cli[11] = command, "1", "1"
		reset, mode = terminalMouseRecoveryForPane(cli)
		if mode != "cli" || len(reset) != 0 {
			t.Fatalf("%s recovery = %q, %q", command, reset, mode)
		}
		protocol := string(terminalMouseProtocolForPane(cli))
		if !strings.Contains(protocol, "\x1b[?1003h") || !strings.Contains(protocol, "\x1b[?1006h") {
			t.Fatalf("%s protocol did not preserve CLI mouse: %q", command, protocol)
		}
	}
}

func TestMouseGuardRealTmuxCLIExitPreservesShellDraft(t *testing.T) {
	binary := os.Getenv("WEBTERM_QA_TMUX")
	if binary == "" {
		t.Skip("set WEBTERM_QA_TMUX")
	}
	dir := t.TempDir()
	socket := filepath.Join(dir, "socket")
	run := func(args ...string) string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, binary, append([]string{"-S", socket}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s %v", args, out, err)
		}
		return strings.TrimSpace(string(out))
	}
	run("-f", "/dev/null", "new-session", "-d", "-s", "qa", "stty -echo; exec bash --noprofile --norc -i")
	defer exec.Command(binary, "-S", socket, "kill-server").Run()
	pane := run("display-message", "-p", "-t", "qa", "#{pane_id}")
	waitCommand := func(want string) {
		t.Helper()
		for j := 0; j < 100; j++ {
			if run("display-message", "-p", "-t", pane, "#{pane_current_command}") == want {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("foreground did not become", want)
	}
	waitCommand("bash")
	// The fixture enables mouse tracking then exits without restoring it after
	// receiving a report, reproducing a disconnected CLI's terminal state.
	report := "\x1b[<64;31;19M"
	script := filepath.Join(dir, "cli.py")
	received := filepath.Join(dir, "received")
	source := "import os,tty\ntty.setraw(0)\nos.write(1,b'\\x1b[?1003h\\x1b[?1006h')\nb=b''\nwhile len(b)<" + strconv.Itoa(len(report)) + ": b+=os.read(0," + strconv.Itoa(len(report)) + "-len(b))\nopen('" + received + "','wb').write(b)\n"
	if err := os.WriteFile(script, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	run("send-keys", "-t", pane, "-l", "python3 "+script)
	run("send-keys", "-t", pane, "Enter")
	waitCommand("python3")
	for j := 0; j < 100; j++ {
		if run("display-message", "-p", "-t", pane, "#{mouse_any_flag}") == "1" {
			break
		}
		if j == 99 {
			t.Fatal("CLI did not enable mouse")
		}
		time.Sleep(20 * time.Millisecond)
	}
	sendGuarded := func() string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, binary, "-S", socket, "source-file", "-")
		cmd.Stdin = strings.NewReader(guardedMouseCommand(pane, report, "WEBTERM_MOUSE_RESET:test"))
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("guard: %s %v", out, err)
		}
		return string(out)
	}
	if strings.Contains(sendGuarded(), "WEBTERM_MOUSE_RESET:test") {
		t.Fatal("live CLI mouse rejected")
	}
	waitCommand("bash")
	got, err := os.ReadFile(received)
	if err != nil || string(got) != report {
		t.Fatalf("CLI input %q %v", got, err)
	}
	output := filepath.Join(dir, "shell-result")
	draft := "printf '中文_OK' > " + output
	run("send-keys", "-t", pane, "-l", draft)
	if !strings.Contains(sendGuarded(), "WEBTERM_MOUSE_RESET:test") {
		t.Fatal("shell mouse not rejected")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("guard submitted shell draft")
	}
	run("send-keys", "-t", pane, "Enter")
	for j := 0; j < 100; j++ {
		got, err = os.ReadFile(output)
		if err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil || string(got) != "中文_OK" {
		t.Fatalf("shell draft corrupted: %q %v", got, err)
	}
}

func TestMouseGuardBrowser(t *testing.T) {
	if os.Getenv("WEBTERM_QA_MOUSE_BROWSER") != "1" {
		t.Skip("set WEBTERM_QA_MOUSE_BROWSER=1")
	}
	payload, err := json.Marshal(map[string]string{"reset": terminalMouseDisable, "snapshot": string(terminalScreenSnapshot([]byte("saved draft"), []string{"%1", "bash", "80", "24", "0", "0", "1", "0", "0", "1", "0", "1"}))})
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", "../scripts/verify-mouse-guard.mjs")
	cmd.Stdin = bytes.NewReader(payload)
	out, err := cmd.CombinedOutput()
	t.Log(string(out))
	if err != nil {
		t.Fatal(err)
	}
}
