package handler

import (
	"bytes"
	"errors"
	"strconv"
	"strings"
)

const terminalPaneStateFormat = "#{pane_id}\t#{pane_current_command}\t#{pane_width}\t#{pane_height}\t#{cursor_x}\t#{cursor_y}\t#{alternate_on}\t#{mouse_standard_flag}\t#{mouse_button_flag}\t#{mouse_any_flag}\t#{mouse_utf8_flag}\t#{mouse_sgr_flag}"

// Both synchronous commands run in the same tmux command queue. The quoted
// semicolon is a tmux argument, not a shell separator between SSH processes.
// Capture only the visible pane, never scrollback or a replacement session.
func initialTerminalScreenStateCaptureCommand(targetName, socket, binary string) string {
	return scopeTmuxCommand("tmux display-message -p -t "+targetName+" '"+terminalPaneStateFormat+"' ';' capture-pane -p -e -t "+targetName, socket, binary)
}

func parseTerminalScreenStateCapture(reply []byte) ([]byte, []string, error) {
	invalid := errors.New("incoherent terminal screen capture")
	metadata, capture, ok := bytes.Cut(reply, []byte("\n"))
	if !ok {
		return nil, nil, invalid
	}
	state := strings.Split(string(metadata), "\t")
	if len(state) != 12 || len(state[0]) < 2 || state[0][0] != '%' {
		return nil, nil, invalid
	}
	if _, err := strconv.ParseUint(state[0][1:], 10, 64); err != nil {
		return nil, nil, invalid
	}
	values := make([]int, 10)
	for i := range values {
		value, err := strconv.Atoi(state[i+2])
		if err != nil {
			return nil, nil, invalid
		}
		values[i] = value
	}
	cols, rows, x, y := values[0], values[1], values[2], values[3]
	// tmux may leave the cursor one column past the edge (pending wrap).
	if cols < 2 || cols > 1000 || rows < 1 || rows > 499 || x < 0 || x > cols || y < 0 || y >= rows {
		return nil, nil, invalid
	}
	for _, flag := range values[4:] {
		if flag != 0 && flag != 1 {
			return nil, nil, invalid
		}
	}
	// Keep blank bottom rows and ANSI bytes: trimming whitespace would hide a
	// mixed-height capture and destroy part of the actual screen.
	lines := bytes.Split(bytes.TrimSuffix(capture, []byte("\n")), []byte("\n"))
	if len(lines) != rows {
		return nil, nil, invalid
	}
	return capture, state, nil
}
