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

// persistentTerminalPanelSessionName keeps the user prefix for isolation and
// exposes the workspace and panel numbers for easy tmux/operator inspection.
// Example: wt01-01-02-<terminal-hash>.
func persistentTerminalPanelSessionName(userID, workspaceIndex, panelNumber int64, terminalID string) (string, error) {
	terminalID = strings.TrimSpace(terminalID)
	if terminalID == "" {
		return "", errors.New("terminal_id is required for persistent sessions")
	}
	if len(terminalID) > maxTerminalIDBytes {
		return "", errors.New("terminal_id is too long")
	}
	if userID < 0 || workspaceIndex < 1 || panelNumber < 1 {
		return "", errors.New("user, workspace, and panel numbers must be positive")
	}
	digest := sha256.Sum256([]byte(terminalID))
	return fmt.Sprintf("wt%02d-%02d-%02d-%x", userID, workspaceIndex, panelNumber, digest[:8]), nil
}

// persistentTerminalCommand derives a tmux command without inserting any
// caller-provided text into the remote shell command line.
func persistentTerminalCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	// Keep the shared tmux grid and mouse behavior, but hide tmux's own status
	// line: WebTerm already provides the tab/panel chrome and the status line
	// otherwise appears as an unexplained green bar at the bottom of every pane.
	command := fmt.Sprintf("tmux start-server \\; set-option -g history-limit %d && (tmux has-session -t %s 2>/dev/null || tmux new-session -d -s %s) && tmux set-option -t %s window-size largest && tmux set-option -t %s status off && tmux set-option -t %s set-titles on && tmux set-option -t %s set-titles-string 'webterm-grid:#{window_width}x#{window_height}' && tmux set-hook -t %s 'client-attached[200]' 'set-option -t %s window-size largest; refresh-client -D -t \"#{hook_client}\" 9999' && tmux set-hook -t %s 'client-resized[200]' 'set-option -t %s window-size largest; refresh-client -D -t \"#{hook_client}\" 9999' && tmux set-hook -w -t %s 'window-resized[200]' 'run-shell \"tmux list-clients -t %s | cut -d: -f1 | xargs -r -I{} tmux refresh-client -D -t {} 9999\"' && tmux set-option -t %s mouse on && tmux set-option -t %s @webterm_mouse_passthrough on && tmux bind-key -n -T root WheelUpPane if-shell -F '#{&&:#{@webterm_mouse_passthrough},#{mouse_any_flag}}' 'send-keys -M' 'if-shell -F \"#{pane_in_mode}\" \"send-keys -M\" \"copy-mode -e; send-keys -M\"' && exec tmux attach-session -t %s", terminalHistoryLines, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName)
	// Control-mode clients do not populate #{hook_client}; guard refresh hooks
	// so an existing session cannot abort the -C attach during its first redraw.
	command = strings.ReplaceAll(command, `refresh-client -D -t "#{hook_client}" 9999`, `if-shell -F "#{hook_client}" "refresh-client -D 9999"`)
	return command, nil
}

// persistentTerminalControlCommand uses tmux's control-mode framing. It is
// opt-in because the browser must also switch its input path to %send-keys;
// normal WebTerm clients continue using the raw PTY command above.
func persistentTerminalControlCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	// Hooks that reference #{hook_client} are valid for normal tmux clients but
	// are not populated by -C control clients. Keep control mode's setup
	// deliberately side-effect free and let the browser own its viewport.
	return fmt.Sprintf("tmux start-server \\; set-option -g history-limit %d && (tmux has-session -t %s 2>/dev/null || tmux new-session -d -s %s) && tmux set-option -t %s window-size largest && tmux set-option -t %s status off && tmux set-option -t %s set-titles on && tmux set-option -t %s set-titles-string 'webterm-grid:#{window_width}x#{window_height}' && tmux set-option -t %s mouse on && tmux set-option -t %s @webterm_mouse_passthrough on && tmux set-hook -t %s 'client-attached[200]' 'set-option -t %s window-size largest; if-shell -F \"#{hook_client}\" \"refresh-client -D 9999\"' && tmux set-hook -t %s 'client-resized[200]' 'set-option -t %s window-size largest; if-shell -F \"#{hook_client}\" \"refresh-client -D 9999\"' && exec tmux -C attach-session -t %s", terminalHistoryLines, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName, sessionName), nil
}

func persistentTerminalFollowInputCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`tmux list-clients -t %s -F '#{client_name}' | while IFS= read -r client; do tmux refresh-client -D -t "$client" 9999; done`, sessionName), nil
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

// persistentTerminalClaudeTranscriptCommand asks an already-running Claude
// fullscreen pane to enter its native transcript view. The command is
// intentionally guarded by pane_current_command so a shell never receives a
// surprising Ctrl+O byte.
func persistentTerminalClaudeTranscriptCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(
		`pane_command="$(tmux display-message -p -t %s '#{pane_current_command}')" && case "$pane_command" in claude|claude-code) tmux send-keys -t %s C-o ;; *) tmux display-message -t %s 'Claude transcript requires an active Claude pane' && exit 64 ;; esac`,
		sessionName, sessionName, sessionName,
	), nil
}

// persistentTerminalResumeInputCommand returns a shared fullscreen TUI to its
// live input area. tmux copy-mode must be cancelled through tmux itself; when
// tmux is already live, Ctrl+End is forwarded to Claude/Codex as their native
// jump-to-bottom shortcut. The target is always derived server-side.
func persistentTerminalResumeInputCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	followCommand, err := persistentTerminalFollowInputCommand(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(
		`if [ "$(tmux display-message -p -t %s '#{pane_in_mode}')" = 1 ]; then tmux send-keys -X -t %s cancel; else tmux send-keys -t %s C-End; fi; %s`,
		sessionName, sessionName, sessionName, followCommand,
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
