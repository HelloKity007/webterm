package handler

import "testing"

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
