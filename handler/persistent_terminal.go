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
	// the large display and expose tmux's dotted padding area.
	return fmt.Sprintf("tmux start-server \\; set-option -g history-limit %d \\; new-session -Ad -s %s && tmux set-option -t %s window-size largest && exec tmux attach-session -t %s", terminalHistoryLines, sessionName, sessionName, sessionName), nil
}

func persistentTerminalClearCommand(userID, connectionID int64, terminalID string) (string, error) {
	sessionName, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("tmux send-keys -t %s C-l && sleep 0.1 && tmux clear-history -t %s", sessionName, sessionName), nil
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
