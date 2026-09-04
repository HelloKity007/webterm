package handler

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
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
	}, session, &input)

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
