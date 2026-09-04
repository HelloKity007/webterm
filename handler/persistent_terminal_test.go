package handler

import (
	"regexp"
	"testing"
)

func TestPersistentTerminalCommandIsStableIsolatedAndShellSafe(t *testing.T) {
	command, err := persistentTerminalCommand(7, 12, "ssh-12-pane-a; rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^tmux start-server \\; set-option -g history-limit 200000 \\; new-session -Ad -s wt-7-12-[a-f0-9]{16} && tmux set-option -t wt-7-12-[a-f0-9]{16} window-size largest && exec tmux attach-session -t wt-7-12-[a-f0-9]{16}$`).MatchString(command) {
		t.Fatalf("command = %q, want a shell-safe persistent tmux command with 200000 history lines and largest-client sizing", command)
	}

	same, err := persistentTerminalCommand(7, 12, "ssh-12-pane-a; rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	otherUser, err := persistentTerminalCommand(8, 12, "ssh-12-pane-a; rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	otherTab, err := persistentTerminalCommand(7, 12, "ssh-12-pane-b")
	if err != nil {
		t.Fatal(err)
	}
	if command != same || command == otherUser || command == otherTab {
		t.Fatalf("persistent commands must be stable per tab and isolated: same=%q otherUser=%q otherTab=%q", same, otherUser, otherTab)
	}
}

func TestPersistentTerminalCommandRejectsMissingTerminalID(t *testing.T) {
	if _, err := persistentTerminalCommand(7, 12, ""); err == nil {
		t.Fatal("missing terminal ID was accepted")
	}
}

func TestPersistentTerminalClearCommandTargetsOnlyTheDerivedTabSession(t *testing.T) {
	command, err := persistentTerminalClearCommand(7, 12, "ssh-12-pane-a; rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^tmux send-keys -t wt-7-12-[a-f0-9]{16} C-l && sleep 0.1 && tmux clear-history -t wt-7-12-[a-f0-9]{16}$`).MatchString(command) {
		t.Fatalf("command = %q, want Ctrl+L followed by clear-history scoped to the derived tab session", command)
	}
}
