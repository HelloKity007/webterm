package handler

import (
	"bytes"
	"testing"
)

func TestTerminalHistoryRetainsBoundedTail(t *testing.T) {
	h := newTerminalHistory(5)
	h.appendBytes([]byte("abc"))
	h.appendBytes([]byte("defg"))
	if got := h.snapshot(); !bytes.Equal(got, []byte("cdefg")) {
		t.Fatalf("snapshot = %q, want %q", got, "cdefg")
	}
}

func TestTerminalHistoryCopiesInputAndSnapshot(t *testing.T) {
	h := newTerminalHistory(16)
	input := []byte("hello")
	h.appendBytes(input)
	input[0] = 'X'
	got := h.snapshot()
	got[0] = 'Y'
	if string(h.snapshot()) != "hello" {
		t.Fatalf("history aliases caller memory: %q", h.snapshot())
	}
}

func TestTerminalHistoryStoreSharesOnlyExactKey(t *testing.T) {
	s := newTerminalHistoryStore(32)
	a := s.get("user:conn:one")
	b := s.get("user:conn:one")
	c := s.get("user:conn:two")
	if a != b {
		t.Fatal("same key returned different history instances")
	}
	if a == c {
		t.Fatal("different keys shared history instance")
	}
}
