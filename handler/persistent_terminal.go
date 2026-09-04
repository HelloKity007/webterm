package handler

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
)

const maxTerminalIDBytes = 256

// persistentTerminalCommand derives a tmux command without inserting any
// caller-provided text into the remote shell command line.
func persistentTerminalCommand(userID, connectionID int64, terminalID string) (string, error) {
	terminalID = strings.TrimSpace(terminalID)
	if terminalID == "" {
		return "", errors.New("terminal_id is required for persistent sessions")
	}
	if len(terminalID) > maxTerminalIDBytes {
		return "", errors.New("terminal_id is too long")
	}
	digest := sha256.Sum256([]byte(terminalID))
	sessionName := fmt.Sprintf("wt-%d-%d-%x", userID, connectionID, digest[:8])
	// A shared persistent terminal may be attached from displays of different
	// sizes.  Keeping tmux at the smallest client size prevents the smaller
	// display from receiving a wider/taller grid than it can render.
	return fmt.Sprintf("tmux new-session -Ad -s %s && tmux set-option -t %s window-size smallest && exec tmux attach-session -t %s", sessionName, sessionName, sessionName), nil
}
