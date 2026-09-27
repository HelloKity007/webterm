package handler

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPersistentSocketRouting(t *testing.T) {
	socket := "/home/pgz/.local/state/webterm/webterm-production-main"
	got := scopeTmuxCommand("tmux has-session && tmux list-sessions", socket)
	if strings.Count(got, "tmux -S "+socket) != 2 {
		t.Fatal(got)
	}
	spec := guardTestSpec()
	spec.Socket = socket
	got, err := spec.command()
	if err != nil || !strings.Contains(got, "'-S' '"+socket+"'") {
		t.Fatalf("%s %v", got, err)
	}
}

func TestPersistentSocketRealTmuxSurvivesTemporaryDirectoryRemoval(t *testing.T) {
	binary := os.Getenv("WEBTERM_QA_TMUX")
	if binary == "" {
		t.Skip("set WEBTERM_QA_TMUX to isolated tmux binary")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	state, err := os.MkdirTemp(home, ".wt-socket-qa-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(state)
	socket := filepath.Join(state, "server")
	temporary := t.TempDir()
	run := func(command string) string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "sh", "-c", scopeTmuxCommand(command, socket, binary))
		cmd.Env = append(os.Environ(), "TMUX_TMPDIR="+temporary)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %s %v", command, out, err)
		}
		return string(out)
	}
	run("tmux -f /dev/null new-session -d -s persistent 'sleep 60'")
	defer exec.Command(binary, "-S", socket, "kill-server").Run()
	before := run("tmux display-message -p -t persistent '#{pid}:#{pane_pid}:#{session_id}'")
	if err := os.RemoveAll(temporary); err != nil {
		t.Fatal(err)
	}
	after := run("tmux display-message -p -t persistent '#{pid}:#{pane_pid}:#{session_id}'")
	if before != after {
		t.Fatalf("identity changed: %s -> %s", before, after)
	}
	run("tmux -N has-session -t persistent")
}
