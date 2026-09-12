package handler

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

type fakeTerminalSession struct {
	closed bool
	rows   int
	cols   int
}

func (s *fakeTerminalSession) WindowChange(rows, cols int) error {
	s.rows, s.cols = rows, cols
	return nil
}

func (s *fakeTerminalSession) Close() error {
	s.closed = true
	return nil
}

func TestPumpTerminalInputClosesSSHSessionWhenBrowserDisconnects(t *testing.T) {
	session := &fakeTerminalSession{}
	messages := []json.RawMessage{json.RawMessage(`{"cols":120,"rows":40}`), json.RawMessage(`{"data":"echo keep"}`)}
	var input strings.Builder

	pumpTerminalInput(func(raw *json.RawMessage) error {
		if len(messages) == 0 {
			return errors.New("browser websocket closed")
		}
		*raw = messages[0]
		messages = messages[1:]
		return nil
	}, session, &input, nil)

	if !session.closed {
		t.Fatal("SSH session was not closed after browser disconnect")
	}
	if session.rows != 40 || session.cols != 120 {
		t.Fatalf("resize = %dx%d, want 40x120", session.rows, session.cols)
	}
	if input.String() != "echo keep" {
		t.Fatalf("stdin = %q, want forwarded terminal input", input.String())
	}
}

func TestPumpTerminalInputRoutesClearHistoryWithoutTypingIt(t *testing.T) {
	session := &fakeTerminalSession{}
	messages := []json.RawMessage{json.RawMessage(`{"action":"clear_history"}`)}
	var input strings.Builder
	var actions []string

	pumpTerminalInput(func(raw *json.RawMessage) error {
		if len(messages) == 0 {
			return errors.New("browser websocket closed")
		}
		*raw = messages[0]
		messages = messages[1:]
		return nil
	}, session, &input, func(action string) error {
		actions = append(actions, action)
		return nil
	})

	if len(actions) != 1 || actions[0] != "clear_history" {
		t.Fatalf("actions = %#v, want clear_history", actions)
	}
	if input.Len() != 0 {
		t.Fatalf("stdin = %q, control action must not be typed into SSH", input.String())
	}
}

func TestPumpTerminalInputRoutesCodexLauncherWithoutTypingIt(t *testing.T) {
	session := &fakeTerminalSession{}
	messages := []json.RawMessage{json.RawMessage(`{"action":"launch_codex_scrollable"}`)}
	var input strings.Builder
	var actions []string

	pumpTerminalInput(func(raw *json.RawMessage) error {
		if len(messages) == 0 {
			return errors.New("browser websocket closed")
		}
		*raw = messages[0]
		messages = messages[1:]
		return nil
	}, session, &input, func(action string) error {
		actions = append(actions, action)
		return nil
	})

	if len(actions) != 1 || actions[0] != "launch_codex_scrollable" {
		t.Fatalf("actions = %#v, want launch_codex_scrollable", actions)
	}
	if input.Len() != 0 {
		t.Fatalf("stdin = %q, launcher action must not be typed directly into SSH", input.String())
	}
}

func TestPumpTerminalInputRoutesResumeInputWithoutTypingIt(t *testing.T) {
	session := &fakeTerminalSession{}
	messages := []json.RawMessage{json.RawMessage(`{"action":"resume_terminal_input"}`)}
	var input strings.Builder
	var actions []string

	pumpTerminalInput(func(raw *json.RawMessage) error {
		if len(messages) == 0 {
			return errors.New("browser websocket closed")
		}
		*raw = messages[0]
		messages = messages[1:]
		return nil
	}, session, &input, func(action string) error {
		actions = append(actions, action)
		return nil
	})

	if len(actions) != 1 || actions[0] != "resume_terminal_input" {
		t.Fatalf("actions = %#v, want resume_terminal_input", actions)
	}
	if input.Len() != 0 {
		t.Fatalf("stdin = %q, resume action must not be typed directly into SSH", input.String())
	}
}

func TestPumpTerminalInputRoutesFollowInputWithoutTypingIt(t *testing.T) {
	session := &fakeTerminalSession{}
	messages := []json.RawMessage{json.RawMessage(`{"action":"follow_terminal_input"}`)}
	var input strings.Builder
	var actions []string

	pumpTerminalInput(func(raw *json.RawMessage) error {
		if len(messages) == 0 {
			return errors.New("browser websocket closed")
		}
		*raw = messages[0]
		messages = messages[1:]
		return nil
	}, session, &input, func(action string) error {
		actions = append(actions, action)
		return nil
	})

	if len(actions) != 1 || actions[0] != "follow_terminal_input" {
		t.Fatalf("actions = %#v, want follow_terminal_input", actions)
	}
	if input.Len() != 0 {
		t.Fatalf("stdin = %q, viewport action must not be typed directly into SSH", input.String())
	}
}

func TestPumpTerminalInputRejectsOutOfRangeAndUnknownMessages(t *testing.T) {
	session := &fakeTerminalSession{}
	messages := []json.RawMessage{
		json.RawMessage(`{"cols":1001,"rows":40}`),
		json.RawMessage(`{"action":"run_arbitrary_command"}`),
		json.RawMessage(`{"data":"` + strings.Repeat("x", maxWSInboundPayloadBytes+1) + `"}`),
	}
	var input strings.Builder
	var codes []string
	pumpTerminalInputWithErrors(func(raw *json.RawMessage) error {
		if len(messages) == 0 {
			return errors.New("browser websocket closed")
		}
		*raw = messages[0]
		messages = messages[1:]
		return nil
	}, session, &input, nil, func(code, _ string) { codes = append(codes, code) })

	if input.Len() != 0 || session.rows != 0 || session.cols != 0 {
		t.Fatalf("invalid messages changed terminal: input=%d resize=%dx%d", input.Len(), session.rows, session.cols)
	}
	want := []string{"INVALID_RESIZE", "UNSUPPORTED_ACTION", "PAYLOAD_TOO_LARGE"}
	if len(codes) != len(want) {
		t.Fatalf("error codes = %#v, want %#v", codes, want)
	}
	for index := range want {
		if codes[index] != want[index] {
			t.Fatalf("error codes = %#v, want %#v", codes, want)
		}
	}
}

type fakePTYSession struct {
	term   string
	height int
	width  int
}

func (s *fakePTYSession) RequestPty(term string, height, width int, _ ssh.TerminalModes) error {
	s.term, s.height, s.width = term, height, width
	return nil
}

func TestDefaultTerminalPTYUsesHeightBeforeWidth(t *testing.T) {
	session := &fakePTYSession{}
	if err := requestDefaultTerminalPTY(session, nil); err != nil {
		t.Fatal(err)
	}
	if session.term != "xterm-256color" || session.height != 40 || session.width != 120 {
		t.Fatalf("RequestPty(%q, %d, %d), want xterm-256color, 40, 120", session.term, session.height, session.width)
	}
}
