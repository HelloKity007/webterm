package handler

import (
	"strings"
	"testing"
)

func TestTerminalSnapshotRestoresGridScreenAndCursor(t *testing.T) {
	got := string(terminalScreenSnapshot([]byte("first\nlast\n"), []string{"%4", "claude", "80", "2", "3", "1", "1"}))
	if !strings.HasPrefix(got, "\x1b]2;webterm-grid:80x2\x07\x1b[?1049h") {
		t.Fatalf("grid and alternate mode missing: %q", got)
	}
	if !strings.Contains(got, "\x1b[1;1Hfirst\x1b[2;1Hlast") {
		t.Fatalf("row positions incorrect: %q", got)
	}
	if strings.Contains(got, "\n") {
		t.Fatal("snapshot must not scroll the last row")
	}
	if !strings.HasSuffix(got, "\x1b[0m\x1b[2;4H") {
		t.Fatalf("cursor not restored: %q", got)
	}
}

func TestTerminalCaptureReturnsEveryRowToFirstColumn(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"196\n197\n198\n", "196\r\n197\r\n198\r\n"},
		{"\x1b[32m中文\x1b[0m\n\nnext\n", "\x1b[32m中文\x1b[0m\r\n\r\nnext\r\n"},
		{"one\r\ntwo\n", "one\r\ntwo\r\n"},
		{"partial", "partial"},
	} {
		if got := string(terminalCaptureBytes([]byte(test.input))); got != test.want {
			t.Fatalf("snapshot=%q got=%q want=%q", test.input, got, test.want)
		}
	}
}

func TestShellSnapshotRetainsHistoryBeyondViewport(t *testing.T) {
	got := string(terminalScreenSnapshot([]byte("oldest\nmiddle\nlast\n"), []string{"%2", "bash", "80", "2", "4", "1", "0"}))
	if !strings.Contains(got, "oldest\r\nmiddle\r\nlast") {
		t.Fatalf("history truncated: %q", got)
	}
	if !strings.HasSuffix(got, "\x1b[0m\x1b[2;5H") {
		t.Fatalf("cursor not restored: %q", got)
	}
}
