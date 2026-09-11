package handler

import (
	"bufio"
	"bytes"
	"io"
	"strconv"
	"strings"
)

// pumpTmuxControlOutput consumes a control-mode stream and forwards only
// pane output events. Protocol notifications remain available to callers via
// the returned event callback, while data is delivered in decoded batches.
func pumpTmuxControlOutput(reader io.Reader, pane string, write func([]byte) error, event func(tmuxControlEvent) error) error {
	scanner := bufio.NewScanner(reader)
	// A redraw event can be large; tmux control mode is line framed but not
	// limited to Scanner's small default token size.
	scanner.Buffer(make([]byte, 32*1024), 2*1024*1024)
	for scanner.Scan() {
		frame, ok := parseTmuxControlLine(scanner.Text())
		if !ok {
			continue
		}
		if event != nil {
			if err := event(frame); err != nil {
				return err
			}
		}
		if frame.Name == "output" && (pane == "" || frame.Pane == pane) && len(frame.Data) > 0 {
			if err := write(frame.Data); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}

// tmuxControlEvent is the subset of tmux -CC events needed by a terminal
// data-plane client. Control mode keeps protocol framing separate from the
// pane's raw ANSI bytes, which is required for per-client viewport handling.
type tmuxControlEvent struct {
	Name string
	Pane string
	Data []byte
	Raw  string
}

// tmuxControlPaneTracker learns the pane id emitted by tmux for a single
// attach stream. A control-mode client must target this id in %send-keys;
// pane ids are server-assigned and must never be guessed from terminal IDs.
type tmuxControlPaneTracker struct {
	pane string
}

func (t *tmuxControlPaneTracker) observe(event tmuxControlEvent) {
	if t != nil && t.pane == "" && event.Name == "output" && event.Pane != "" {
		t.pane = event.Pane
	}
}

func (t *tmuxControlPaneTracker) target() string {
	if t == nil {
		return ""
	}
	return t.pane
}

// encodeTmuxControlSendKeys builds a control-mode command without allowing
// terminal input to escape into the protocol. tmux control commands are
// newline framed; shell-style single quoting keeps arbitrary UTF-8 and quote
// characters inside the -l payload.
func encodeTmuxControlSendKeys(pane, data string) string {
	if pane == "" || data == "" {
		return ""
	}
	quoted := "'" + strings.ReplaceAll(data, "'", "'\\''") + "'"
	return "%send-keys -t " + pane + " -l -- " + quoted + "\n"
}

// tmuxControlInput forwards browser bytes only after the control stream has
// announced a real pane id. Before that point input is rejected rather than
// risking protocol corruption or sending keystrokes to an unintended pane.
type tmuxControlInput struct {
	tracker *tmuxControlPaneTracker
	writer  io.Writer
}

func (i *tmuxControlInput) Write(data []byte) (int, error) {
	if err := i.write(string(data)); err != nil {
		return 0, err
	}
	return len(data), nil
}

func (i *tmuxControlInput) write(data string) error {
	if i == nil || i.writer == nil {
		return io.ErrClosedPipe
	}
	command := encodeTmuxControlSendKeys(i.tracker.target(), data)
	if command == "" {
		return io.ErrShortWrite
	}
	_, err := io.WriteString(i.writer, command)
	return err
}

// parseTmuxControlLine parses one complete line from tmux -CC. tmux escapes
// pane output using octal bytes (\ooo), backslash, and line continuations.
func parseTmuxControlLine(line string) (tmuxControlEvent, bool) {
	line = strings.TrimSuffix(line, "\r")
	if !strings.HasPrefix(line, "%") {
		return tmuxControlEvent{}, false
	}
	parts := strings.SplitN(line[1:], " ", 3)
	if len(parts) == 0 || parts[0] == "" {
		return tmuxControlEvent{}, false
	}
	event := tmuxControlEvent{Name: parts[0], Raw: line}
	if event.Name != "output" {
		return event, true
	}
	if len(parts) != 3 {
		return tmuxControlEvent{}, false
	}
	event.Pane = parts[1]
	data, ok := decodeTmuxControlData(parts[2])
	if !ok {
		return tmuxControlEvent{}, false
	}
	event.Data = data
	return event, true
}

func decodeTmuxControlData(encoded string) ([]byte, bool) {
	var out bytes.Buffer
	for i := 0; i < len(encoded); i++ {
		if encoded[i] != '\\' {
			out.WriteByte(encoded[i])
			continue
		}
		if i+1 >= len(encoded) {
			return nil, false
		}
		i++
		switch encoded[i] {
		case '\\':
			out.WriteByte('\\')
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 't':
			out.WriteByte('\t')
		case 'b':
			out.WriteByte('\b')
		case 'f':
			out.WriteByte('\f')
		case 'v':
			out.WriteByte('\v')
		case 'a':
			out.WriteByte('\a')
		case '0', '1', '2', '3', '4', '5', '6', '7':
			end := i + 3
			if end > len(encoded) {
				return nil, false
			}
			value, err := strconv.ParseUint(encoded[i:end], 8, 8)
			if err != nil {
				return nil, false
			}
			out.WriteByte(byte(value))
			i = end - 1
		default:
			return nil, false
		}
	}
	return out.Bytes(), true
}
