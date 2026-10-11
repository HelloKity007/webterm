package handler

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestTerminalScreenStateCaptureCoherence(t *testing.T) {
	metadata := "%1\tclaude\t93\t3\t2\t1\t1\t0\t0\t1\t0\t1\n"
	for _, tc := range []struct {
		name, reply string
		valid       bool
	}{
		{"coherent", metadata + "top\ncomposer\nstatus\n", true},
		{"mixed height", metadata + "top\ncomposer\n", false},
		{"missing metadata", "top\ncomposer\nstatus\n", false},
		{"invalid identity", strings.Replace(metadata, "%1", "not-a-pane", 1) + "top\ncomposer\nstatus\n", false},
		{"invalid dimensions", strings.Replace(metadata, "93\t3", "0\t3", 1) + "top\ncomposer\nstatus\n", false},
		{"invalid cursor", strings.Replace(metadata, "2\t1\t1", "2\t3\t1", 1) + "top\ncomposer\nstatus\n", false},
		{"invalid mode", strings.Replace(metadata, "2\t1\t1", "2\t1\t2", 1) + "top\ncomposer\nstatus\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			capture, state, err := parseTerminalScreenStateCapture([]byte(tc.reply))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
			if tc.valid && (state[2] != "93" || !bytes.Equal(capture, []byte("top\ncomposer\nstatus\n"))) {
				t.Fatal("metadata and capture were not kept together")
			}
		})
	}
}

func TestTerminalScreenStateCapturePreservesBlankRowsAndANSI(t *testing.T) {
	body := []byte("\x1b[32mtext\x1b[0m\n\n\n")
	reply := append([]byte("%1\tbash\t93\t3\t93\t1\t0\t0\t0\t0\t0\t0\n"), body...)
	capture, _, err := parseTerminalScreenStateCapture(reply)
	if err != nil || !bytes.Equal(capture, body) {
		t.Fatalf("visible blank rows, ANSI or pending-wrap cursor lost: %v", err)
	}
}

func TestTerminalScreenStateCaptureUsesOneTmuxQueue(t *testing.T) {
	command := initialTerminalScreenStateCaptureCommand("wt-safe", "/tmp/test-socket", "/opt/tmux")
	if strings.Count(command, "display-message") != 1 || strings.Count(command, "capture-pane") != 1 || !strings.Contains(command, " ';' ") {
		t.Fatalf("state and capture are not one tmux command queue: %s", command)
	}
	if strings.Contains(command, "new-session") || strings.Contains(command, " -S -") {
		t.Fatalf("bootstrap must not create sessions or replay history: %s", command)
	}
}

func TestTerminalScreenStateCaptureRealTmux(t *testing.T) {
	binary := os.Getenv("WEBTERM_QA_TMUX_BINARY")
	if binary == "" {
		var err error
		binary, err = exec.LookPath("tmux")
		if err != nil {
			t.Skip("tmux required for isolated capture integration")
		}
	}
	socket := fmt.Sprintf("qa-bootstrap-capture-%d-%d", os.Getpid(), time.Now().UnixNano())
	run := func(args ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, binary, append([]string{"-L", socket}, args...)...).CombinedOutput()
	}
	fixture := "printf '\\033[32mCAPTURE_MARKER\\033[0m\\n'; sleep 60"
	if out, err := run("-f", "/dev/null", "new-session", "-d", "-s", "fixture", "-x", "93", "-y", "31", fixture); err != nil {
		t.Fatalf("isolated fixture: %v %s", err, out)
	}
	t.Cleanup(func() { _, _ = run("kill-server") })
	command := initialTerminalScreenStateCaptureCommand("fixture", socket, binary)
	for _, height := range []string{"31", "38", "26", "38"} {
		if out, err := run("resize-window", "-t", "fixture", "-x", "93", "-y", height); err != nil {
			t.Fatalf("resize fixture: %v %s", err, out)
		}
		deadline := time.Now().Add(3 * time.Second)
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			reply, err := exec.CommandContext(ctx, "sh", "-c", command).CombinedOutput()
			cancel()
			if err != nil {
				t.Fatalf("capture command: %v %s", err, reply)
			}
			capture, state, err := parseTerminalScreenStateCapture(reply)
			if err != nil {
				t.Fatalf("real tmux state/capture incoherent: %v", err)
			}
			if state[2] != "93" {
				t.Fatalf("unexpected fixture width: %s", state[2])
			}
			if bytes.Contains(capture, []byte("CAPTURE_MARKER")) {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("fixture marker missing")
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
}
