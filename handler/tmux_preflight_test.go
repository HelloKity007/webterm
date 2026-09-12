package handler

import (
	"errors"
	"sync/atomic"
	"testing"

	"github.com/xufanchn/webterm/sshmgr"
	"github.com/xufanchn/webterm/store"
)

func TestCheckTmuxVersion(t *testing.T) {
	tests := []struct {
		name   string
		output string
		runErr error
		code   string
	}{
		{name: "three zero", output: "tmux 3.0", code: "TMUX_TOO_OLD"},
		{name: "minimum", output: "tmux 3.1"},
		{name: "double digit minor", output: "tmux 3.10"},
		{name: "patch suffix", output: "tmux 3.4a"},
		{name: "missing", output: "sh: tmux: not found", runErr: errors.New("exit 127"), code: "TMUX_MISSING"},
		{name: "unknown", output: "tmux next-3.5", code: "TMUX_VERSION_UNKNOWN"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := checkTmuxVersion(test.output, test.runErr)
			if test.code == "" {
				if err != nil {
					t.Fatalf("checkTmuxVersion() error = %v", err)
				}
				return
			}
			var typed *tmuxPreflightError
			if !errors.As(err, &typed) || typed.Code != test.code {
				t.Fatalf("checkTmuxVersion() error = %#v, want code %s", err, test.code)
			}
		})
	}
}

func TestTmuxPreflightCachesAndInvalidatesOnConnectionChange(t *testing.T) {
	var calls atomic.Int32
	handler := &WSHandler{RunTmuxPreflight: func(*sshmgr.Client) (string, error) {
		calls.Add(1)
		return "tmux 3.4", nil
	}}
	connection := &store.Connection{ID: 7, Host: "host-a", Port: 22, Username: "admin", PasswordEncrypted: "first"}
	if err := handler.ensureTmuxPreflight(connection, nil); err != nil {
		t.Fatal(err)
	}
	if err := handler.ensureTmuxPreflight(connection, nil); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("preflight calls = %d, want cached single call", calls.Load())
	}
	changed := *connection
	changed.PasswordEncrypted = "second"
	if err := handler.ensureTmuxPreflight(&changed, nil); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("preflight calls after config change = %d, want 2", calls.Load())
	}
}
