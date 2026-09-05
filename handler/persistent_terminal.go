package handler

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
)

const (
	maxTerminalIDBytes   = 256
	terminalHistoryLines = 200000
)

func persistentTerminalSessionName(userID, connectionID int64, terminalID string) (string, error) {
	terminalID = strings.TrimSpace(terminalID)
	if terminalID == "" {
		return "", errors.New("terminal_id is required for persistent sessions")
	}
	if len(terminalID) > maxTerminalIDBytes {
		return "", errors.New("terminal_id is too long")
	}
	digest := sha256.Sum256([]byte(terminalID))
	return fmt.Sprintf("wt-%d-%d-%x", userID, connectionID, digest[:8]), nil
}

// persistentTerminalCommand derives a tmux command without inserting any
// caller-provided text into the remote shell command line.
func persistentTerminalCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	// tmux has one grid per shared window. Keep that grid at the largest attached
	// browser size so a reconnect, tab rename, or smaller display cannot shrink
	// the large display and expose tmux's dotted padding area. Mouse mode is set
	// on this WebTerm session (rather than globally) so wheel events are forwarded
	// to full-screen applications such as Claude Code and otherwise enter tmux
	// copy mode for shell scrollback. Some user configs override WheelUpPane without
	// checking mouse_any_flag. Tag WebTerm sessions and install a conditional wrapper
	// that preserves that legacy behavior for every untagged/non-mouse pane.
	return fmt.Sprintf("tmux start-server \\; set-option -g history-limit %d \\; new-session -Ad -s %s && tmux set-option -t %s window-size largest && tmux set-option -t %s mouse on && tmux set-option -t %s @webterm_mouse_passthrough on && tmux bind-key -n -T root WheelUpPane if-shell -F '#{&&:#{@webterm_mouse_passthrough},#{mouse_any_flag}}' 'send-keys -M' 'if-shell -F \"#{pane_in_mode}\" \"send-keys -M\" \"copy-mode -e; send-keys -M\"' && exec tmux attach-session -t %s", terminalHistoryLines, sessionName, sessionName, sessionName, sessionName, sessionName), nil
}

func persistentTerminalClearCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("tmux send-keys -t %s C-l && sleep 0.1 && tmux clear-history -t %s", sessionName, sessionName), nil
}

// persistentTerminalCodexScrollableCommand starts Codex only when the active
// tmux pane is sitting at a known interactive shell. The browser sends a fixed
// action name; neither the terminal ID nor arbitrary client text is ever
// inserted into the command that tmux types.
func persistentTerminalCodexScrollableCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(
		`pane_command="$(tmux display-message -p -t %s '#{pane_current_command}')" && case "$pane_command" in sh|bash|zsh|dash|ash|ksh|mksh|fish|nu|xonsh|elvish) tmux send-keys -t %s -l 'codex --no-alt-screen' && tmux send-keys -t %s Enter ;; *) tmux display-message -t %s 'Codex scrollable mode requires an idle shell' && exit 64 ;; esac`,
		sessionName, sessionName, sessionName, sessionName,
	), nil
}

func persistentTerminalCloseCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	// Closing a stale/restored tab is intentionally idempotent. The session name
	// contains controlled characters only, so no caller input reaches the shell.
	return fmt.Sprintf("tmux kill-session -t %s 2>/dev/null || true", sessionName), nil
}
