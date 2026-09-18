package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// Opt-in diagnostic: exercise the real snapshot encoder/output ordering in
// Chromium/xterm. It does not connect to any running WebTerm or user session.
// The schedules are controlled reproductions, not proof that a recorded user
// failure followed one particular schedule.
func TestSnapshotRestoreOrderingBrowser(t *testing.T) {
	if os.Getenv("WEBTERM_QA_SNAPSHOT_ORDER") != "1" {
		t.Skip("set WEBTERM_QA_SNAPSHOT_ORDER=1 for isolated Chromium diagnosis")
	}
	type scenario struct {
		Name   string `json:"name"`
		Stream string `json:"stream"`
	}
	state := func(rows int) []string {
		return []string{"%1", "claude", "104", fmt.Sprint(rows), "2", fmt.Sprint(rows - 3), "1", "0", "0", "1", "0", "1"}
	}
	capture := func(rows int, generation string) []byte {
		lines := make([]string, rows)
		for i := range lines {
			lines[i] = fmt.Sprintf("%s row %02d", generation, i+1)
		}
		lines[rows-4] = "Jump to bottom (ctrl+End)"
		lines[rows-3] = "COMPOSER_SEPARATOR"
		lines[rows-2] = "COMPOSER_DRAFT_UNSUBMITTED"
		lines[rows-1] = "STATUSLINE_CURRENT"
		return []byte(strings.Join(lines, "\n") + "\n")
	}
	currentCapture := capture(38, "CURRENT")
	current := terminalScreenSnapshot(currentCapture, state(38))
	var cases []scenario
	cases = append(cases, scenario{"coherent-control", string(current)})
	// The metadata command completes at 26 rows; capture executes after a
	// concurrent resize to 38. This is permitted by the two-channel bootstrap.
	var mismatched bytes.Buffer
	a := &terminalOutputOrder{write: func(p []byte) error { _, err := mismatched.Write(p); return err }}
	if err := a.grid([]byte("\x1b]2;webterm-grid:104x38\x07")); err != nil {
		t.Fatal(err)
	}
	if err := a.snapshot(terminalScreenSnapshot(currentCapture, state(26))); err != nil {
		t.Fatal(err)
	}
	cases = append(cases, scenario{"metadata-before-resize-capture-after", mismatched.String()})
	// A coherent 26-row snapshot is delayed. A newer full 38-row redraw reaches
	// the browser first; the old snapshot arrives last and erases those pixels.
	var late bytes.Buffer
	b := &terminalOutputOrder{write: func(p []byte) error { _, err := late.Write(p); return err }}
	if err := b.grid([]byte("\x1b]2;webterm-grid:104x38\x07")); err != nil {
		t.Fatal(err)
	}
	if err := b.output(current); err != nil {
		t.Fatal(err)
	}
	if err := b.snapshot(terminalScreenSnapshot(capture(26, "STALE"), state(26))); err != nil {
		t.Fatal(err)
	}
	cases = append(cases, scenario{"late-snapshot-after-newer-redraw", late.String()})
	// Rejecting only differently-sized snapshots would still lose newer
	// content when the grid is unchanged. Keep that counterexample explicit.
	var sameSize bytes.Buffer
	c := &terminalOutputOrder{write: func(p []byte) error { _, err := sameSize.Write(p); return err }}
	if err := c.grid([]byte("\x1b]2;webterm-grid:104x38\x07")); err != nil {
		t.Fatal(err)
	}
	if err := c.output(current); err != nil {
		t.Fatal(err)
	}
	if err := c.snapshot(terminalScreenSnapshot(capture(38, "STALE"), state(38))); err != nil {
		t.Fatal(err)
	}
	cases = append(cases, scenario{"late-snapshot-same-grid", sameSize.String()})
	payload, err := json.Marshal(cases)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("node", "../scripts/diagnose-snapshot-order.mjs")
	command.Stdin = bytes.NewReader(payload)
	output, err := command.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatalf("snapshot restoration lost current screen content: %v", err)
	}
}
