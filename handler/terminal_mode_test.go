package handler

import "testing"

func TestTerminalModeForPane(t *testing.T) {
	for _, test := range []struct {
		command, want string
		alternate     bool
	}{
		{"bash", "shell", false}, {"claude.exe", "cli", false},
		{"ssh", "unknown", false}, {"docker", "unknown", false},
		{"ssh", "cli", true}, {"bash", "cli", true},
	} {
		if got := terminalModeForPane(test.command, test.alternate); got != test.want {
			t.Errorf("%s alternate=%v: got %s, want %s", test.command, test.alternate, got, test.want)
		}
	}
}
