package handler

import (
	"bytes"
	"testing"
)

func TestLateSnapshotDoesNotReplaceLatestLiveGrid(t *testing.T) {
	var out bytes.Buffer
	order := &terminalOutputOrder{write: func(data []byte) error { _, err := out.Write(data); return err }}
	latest := []byte("\x1b]2;webterm-grid:104x36\x07")
	if err := order.grid(latest); err != nil {
		t.Fatal(err)
	}
	if err := order.snapshot([]byte("\x1b]2;webterm-grid:104x31\x07snapshot")); err != nil {
		t.Fatal(err)
	}
	if !bytes.HasSuffix(out.Bytes(), latest) {
		t.Fatalf("stale final grid: %q", out.String())
	}
	if err := order.output([]byte("live")); err != nil {
		t.Fatal(err)
	}
	if !bytes.HasSuffix(out.Bytes(), append(latest, []byte("live")...)) {
		t.Fatal("live output not ordered after latest grid")
	}
}
