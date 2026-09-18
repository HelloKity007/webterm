package handler

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const guardTestIncarnation = "11111111-1111-4111-8111-111111111111"
const guardTestNonce = "0123456789abcdef0123456789abcdef"

func guardTestSpec() terminalIdentityAttachSpec {
	return terminalIdentityAttachSpec{Binary: "/opt/tmux fixed/bin/tmux", Socket: "qa-only", Session: "registry_target", Incarnation: guardTestIncarnation, Nonce: guardTestNonce}
}

func TestIdentityAttachRealTmuxReplacementAndMissing(t *testing.T) {
	binary := os.Getenv("WEBTERM_QA_TMUX")
	if binary == "" {
		t.Skip("set WEBTERM_QA_TMUX to isolated tmux 3.7c binary")
	}
	socket := fmt.Sprintf("qa-identity-guard-%d", time.Now().UnixNano())
	command := func(args ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, binary, append([]string{"-L", socket}, args...)...).CombinedOutput()
	}
	if out, err := command("-f", "/dev/null", "new-session", "-d", "-s", "qa-anchor", "sleep 60"); err != nil {
		t.Fatalf("fixture: %s %v", out, err)
	}
	t.Cleanup(func() { _, _ = command("-N", "kill-server") })
	create := func(inc string) {
		t.Helper()
		out, err := command("new-session", "-d", "-s", "registry_target", "sleep 60", ";", "set-option", "-t", "=registry_target:", "@webterm_incarnation", inc)
		if err != nil {
			t.Fatalf("create: %s %v", out, err)
		}
	}
	run := func() (bool, string) {
		t.Helper()
		spec := guardTestSpec()
		spec.Binary = binary
		spec.Socket = socket
		line, err := spec.command()
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "sh", "-c", line)
		stdin, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err = cmd.Start(); err != nil {
			t.Fatal(err)
		}
		guard := newTerminalIdentityAttachGuard(spec)
		scanner := bufio.NewScanner(stdout)
		ready := false
		var transcript strings.Builder
		for scanner.Scan() {
			raw := scanner.Text()
			transcript.WriteString(raw + "\n")
			if ready {
				continue
			}
			ok, e := guard.observeLine(raw)
			if ok {
				ready = true
				fmt.Fprintln(stdin, "detach-client")
			}
			if e != nil {
				stdin.Close()
			}
		}
		stdin.Close()
		_ = cmd.Wait()
		if ctx.Err() != nil {
			t.Fatal("guarded attach timed out")
		}
		if err = scanner.Err(); err != nil {
			t.Fatal(err)
		}
		return ready, transcript.String()
	}
	create(guardTestIncarnation)
	if ready, out := run(); !ready {
		t.Fatalf("matching identity failed: %s", out)
	} else {
		t.Logf("MATCH: %s", out)
	}
	if out, err := command("kill-session", "-t", "=registry_target"); err != nil {
		t.Fatalf("kill fixture: %s %v", out, err)
	}
	create("22222222-2222-4222-8222-222222222222")
	if ready, out := run(); ready || strings.Contains(out, "%session-changed") {
		t.Fatalf("same-name replacement attached: %s", out)
	} else {
		t.Logf("REPLACEMENT: %s", out)
	}
	_, _ = command("kill-session", "-t", "=registry_target")
	if ready, out := run(); ready || strings.Contains(out, "%session-changed") {
		t.Fatalf("missing session attached: %s", out)
	} else {
		t.Logf("MISSING: %s", out)
	}
	if out, err := command("list-sessions", "-F", "#{session_name}"); err != nil || strings.TrimSpace(string(out)) != "qa-anchor" {
		t.Fatalf("unexpected sessions: %s %v", out, err)
	}
	_, _ = command("kill-server")
	if ready, out := run(); ready {
		t.Fatalf("absent server attached: %s", out)
	}
	if out, err := command("-N", "list-sessions"); err == nil {
		t.Fatalf("server was recreated: %s", out)
	}
}

func TestIdentityAttachCommandFailsClosed(t *testing.T) {
	command, err := guardTestSpec().command()
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"new-session", "start-server", "has-session", "||", "run-shell"} {
		if strings.Contains(command, bad) {
			t.Fatalf("creating/async syntax: %s", command)
		}
	}
	if !strings.Contains(command, "'-N'") || !strings.Contains(command, "'if-shell' '-F'") {
		t.Fatal(command)
	}
	for _, name := range []string{"name; new-session -s bad", "name\nnew-session", "#{pane_id}", "name:window"} {
		spec := guardTestSpec()
		spec.Session = name
		if _, err := spec.command(); err == nil {
			t.Fatalf("unsafe name %q accepted", name)
		}
	}
	spec := guardTestSpec()
	spec.Nonce = ""
	if _, err := spec.command(); err == nil {
		t.Fatal("missing per-attach nonce accepted")
	}
}

func TestIdentityAttachDefaultSocketDoesNotInventNamedNamespace(t *testing.T) {
	spec := guardTestSpec()
	spec.Socket = ""
	command, err := spec.command()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(command, "'-L'") || !strings.Contains(command, "'-N' '-C'") {
		t.Fatalf("default socket attach changed tmux namespace: %s", command)
	}
}

func TestIdentityAttachShellQuotingPreservesLiteralArguments(t *testing.T) {
	spec := guardTestSpec()
	spec.Binary = "/opt/tmux 'literal;$(printf injected)/tmux"
	spec.Socket = "qa 'socket;$(printf injected)"
	command, err := spec.command()
	if err != nil {
		t.Fatal(err)
	}
	// Parse the shell argument vector without executing any of its arguments.
	out, err := exec.Command("sh", "-c", "set -- "+strings.TrimPrefix(command, "exec ")+"; printf '%s\\n' \"$1\" \"$4\"").CombinedOutput()
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != spec.Binary+"\n"+spec.Socket+"\n" {
		t.Fatalf("shell altered literal arguments: %q", out)
	}
}

func TestIdentityAttachReadyRequiresCompletedFrameAndSession(t *testing.T) {
	guard := newTerminalIdentityAttachGuard(guardTestSpec())
	lines := []string{"%begin 123 1 0", "WEBTERM_READY:" + guardTestIncarnation + ":" + guardTestNonce, "%end 123 1 0"}
	for _, line := range lines {
		if ready, err := guard.observeLine(line); err != nil || ready {
			t.Fatalf("premature readiness %v %v", ready, err)
		}
	}
	if ready, err := guard.observeLine("%session-changed $0 registry_target"); err != nil || !ready {
		t.Fatalf("verified attach rejected %v %v", ready, err)
	}
	if _, err := guard.observeLine("%session-changed $1 replacement"); err == nil {
		t.Fatal("unexpected session switch accepted")
	}
}

func TestIdentityAttachRejectsSpoofedOrFailedReadiness(t *testing.T) {
	marker := "WEBTERM_READY:" + guardTestIncarnation + ":" + guardTestNonce
	cases := [][]string{
		{marker, "%session-changed $0 registry_target"},
		{"%output %0 " + marker, "%session-changed $0 registry_target"},
		{"%begin 123 1 0", marker, "%error 123 1 0", "%session-changed $0 registry_target"},
		{"%begin 123 1 0", marker, "%end 123 2 0", "%session-changed $0 registry_target"},
		{"%begin 123 1 0", "WEBTERM_READY:wrong:" + guardTestNonce, "%end 123 1 0", "%session-changed $0 registry_target"},
		{"%begin 123 1 0", marker, "unexpected body", "%end 123 1 0", "%session-changed $0 registry_target"},
		{"%begin 123 1 0", "%output %0 " + marker, "%end 123 1 0", "%session-changed $0 registry_target"},
	}
	for i, lines := range cases {
		guard := newTerminalIdentityAttachGuard(guardTestSpec())
		for _, line := range lines {
			ready, err := guard.observeLine(line)
			if ready {
				t.Fatalf("case %d accepted forged/failed marker", i)
			}
			if err != nil {
				break
			}
		}
	}
}
