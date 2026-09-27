package handler

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
)

const terminalMouseDisable = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l"

// xterm and our mouse handlers emit complete SGR reports. Match only entire
// reports (possibly batched), never printable text, cursor keys or a paste.
var terminalMouseReports = regexp.MustCompile(`^(\x1b\[<[0-9]+;[0-9]+;[0-9]+[Mm])+$`)

func terminalIsShell(command string) bool {
	switch strings.ToLower(strings.TrimSpace(command)) {
	case "sh", "bash", "zsh", "dash", "ash", "ksh", "mksh", "fish", "nu", "xonsh", "elvish":
		return true
	}
	return false
}

// terminalMouseProtocolForPane reconstructs the mouse protocol represented by
// tmux's pane flags. A shell is deliberately never allowed to inherit an
// application's stale mouse flags: a killed CLI can leave them set until
// another program explicitly changes the terminal modes.
func terminalMouseProtocolForPane(state []string) []byte {
	if len(state) < 12 {
		return nil
	}
	var out bytes.Buffer
	out.WriteString(terminalMouseDisable)
	if terminalIsShell(state[1]) {
		return out.Bytes()
	}
	for index, mouseMode := range []int{1000, 1002, 1003, 1005, 1006} {
		if state[7+index] == "1" {
			fmt.Fprintf(&out, "\x1b[?%dh", mouseMode)
		}
	}
	return out.Bytes()
}

// terminalMouseRecoveryForPane returns the client-side reset needed when an
// application disappears and tmux is back at a known shell. It intentionally
// does not guess for nested ssh/docker processes: their foreground command is
// ambiguous and forcing a reset could break a still-live terminal program.
func terminalMouseRecoveryForPane(state []string) ([]byte, string) {
	if len(state) < 2 {
		return nil, "unknown"
	}
	mode := terminalModeForPane(state[1], len(state) >= 7 && state[6] == "1")
	if mode != "shell" || len(state) < 12 {
		return nil, mode
	}
	if terminalPaneHasMouse(state) {
		return []byte(terminalMouseDisable), mode
	}
	return nil, mode
}

func terminalPaneHasMouse(state []string) bool {
	if len(state) < 12 {
		return false
	}
	for _, flag := range state[7:12] {
		if flag == "1" {
			return true
		}
	}
	return false
}

func guardedMouseCommand(pane, data, marker string) string {
	command := strings.TrimSuffix(encodeTmuxControlSendKeys(pane, data), "\n")
	// Both branches execute within tmux's command queue; there is no SSH
	// round-trip between checking the foreground command and forwarding input.
	condition := "#{m/r:^(sh|bash|zsh|dash|ash|ksh|mksh|fish|nu|xonsh|elvish)$,#{pane_current_command}}"
	return fmt.Sprintf("if-shell -F -t %s '%s' 'display-message -p %s' '%s'\n", pane, condition, marker, command)
}

// Only a complete command-response frame can acknowledge the guard. Pane
// output containing the same text is never accepted as a control response.
type terminalMouseGuardResponse struct {
	marker, frame, body string
	lines               int
}

func (g *terminalMouseGuardResponse) observe(line string) bool {
	line = strings.TrimSuffix(line, "\r")
	if m := identityResponseFramePattern.FindStringSubmatch(line); m != nil {
		if m[1] == "begin" {
			g.frame, g.body, g.lines = m[2], "", 0
			return false
		}
		ok := m[1] == "end" && g.frame == m[2] && g.lines == 1 && g.body == g.marker
		g.frame, g.body, g.lines = "", "", 0
		return ok
	}
	if g.frame != "" && !strings.HasPrefix(line, "%") {
		g.lines++
		if g.lines == 1 {
			g.body = line
		}
	}
	return false
}
