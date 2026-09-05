package handler

import (
	"regexp"
	"strings"
	"testing"
)

func TestPersistentTerminalCommandIsStableIsolatedAndShellSafe(t *testing.T) {
	command, err := persistentTerminalCommand(7, 12, "ssh-12-pane-a; rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^tmux start-server \\; set-option -g history-limit 200000 \\; new-session -Ad -s wt-7-12-[a-f0-9]{16}`).MatchString(command) {
		t.Fatalf("command = %q, want a shell-safe persistent tmux command with 200000 history lines", command)
	}
	for _, fragment := range []string{
		"window-size smallest",
		"mouse on",
		"@webterm_mouse_passthrough on",
		`#{&&:#{@webterm_mouse_passthrough},#{mouse_any_flag}}`,
		`if-shell -F "#{pane_in_mode}" "send-keys -M" "copy-mode -e; send-keys -M"`,
		"exec tmux attach-session",
	} {
		if !strings.Contains(command, fragment) {
			t.Fatalf("command = %q, missing %q", command, fragment)
		}
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

func TestPersistentTerminalResumeInputCommandIsFixedAndScoped(t *testing.T) {
	command, err := persistentTerminalResumeInputCommand(7, 12, "ssh-12-pane-a; rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^if \[ "\$\(tmux display-message -p -t wt-7-12-[a-f0-9]{16} '#\{pane_in_mode\}'\)" = 1 \]; then tmux send-keys -X -t wt-7-12-[a-f0-9]{16} cancel; else tmux send-keys -t wt-7-12-[a-f0-9]{16} C-End; fi$`).MatchString(command) {
		t.Fatalf("command = %q, want a fixed copy-mode cancel / Ctrl+End action", command)
	}
	if strings.Contains(command, "pane-a") || strings.Contains(command, "rm -rf") {
		t.Fatalf("unsafe terminal ID leaked into command: %q", command)
	}
}

func TestPersistentTerminalCodexScrollableCommandIsFixedAndShellGuarded(t *testing.T) {
	command, err := persistentTerminalCodexScrollableCommand(7, 12, "ssh-12-pane-a; rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^pane_command="\$\(tmux display-message -p -t wt-7-12-[a-f0-9]{16} '#\{pane_current_command\}'\)" && case "\$pane_command" in sh\|bash\|zsh\|dash\|ash\|ksh\|mksh\|fish\|nu\|xonsh\|elvish\) tmux send-keys -t wt-7-12-[a-f0-9]{16} -l 'codex --no-alt-screen' && tmux send-keys -t wt-7-12-[a-f0-9]{16} Enter ;; \*\) tmux display-message -t wt-7-12-[a-f0-9]{16} 'Codex scrollable mode requires an idle shell' && exit 64 ;; esac$`).MatchString(command) {
		t.Fatalf("command = %q, want a fixed Codex launcher guarded by pane_current_command", command)
	}
	if strings.Contains(command, "pane-a") || strings.Contains(command, "rm -rf") {
		t.Fatalf("unsafe terminal ID leaked into command: %q", command)
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
