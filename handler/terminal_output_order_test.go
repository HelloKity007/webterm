package handler

import (
	"bytes"
	"testing"
)

func TestTerminalSnapshotRejectsSourceChanges(t *testing.T) {
	grid := []byte("\x1b]2;webterm-grid:104x36\x07")
	for _, tc := range []struct {
		name      string
		freshGrid []byte
		change    func(*terminalOutputOrder) error
	}{
		{"resized", []byte("\x1b]2;webterm-grid:104x38\x07"), func(o *terminalOutputOrder) error { return o.grid([]byte("\x1b]2;webterm-grid:104x38\x07")) }},
		{"same grid newer content", grid, func(o *terminalOutputOrder) error { return o.output([]byte("CURRENT")) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			order := &terminalOutputOrder{write: func(data []byte) error { _, err := out.Write(data); return err }}
			if err := order.grid(grid); err != nil {
				t.Fatal(err)
			}
			version := order.captureVersion()
			if err := tc.change(order); err != nil {
				t.Fatal(err)
			}
			before := append([]byte(nil), out.Bytes()...)
			accepted, err := order.snapshot(append(append([]byte(nil), grid...), []byte("STALE")...), version)
			if err != nil || accepted || !bytes.Equal(before, out.Bytes()) {
				t.Fatalf("stale pixels published: accepted=%v error=%v output=%q", accepted, err, out.String())
			}
			fresh := append(append([]byte(nil), tc.freshGrid...), []byte("FRESH")...)
			accepted, err = order.snapshot(fresh, order.captureVersion())
			want := append(append(append([]byte(nil), before...), fresh...), tc.freshGrid...)
			if err != nil || !accepted || !bytes.Equal(out.Bytes(), want) {
				t.Fatalf("fresh recapture rejected: accepted=%v error=%v", accepted, err)
			}
		})
	}
}

func TestTerminalSnapshotRequiresMatchingGridEvenWithoutObservedChange(t *testing.T) {
	var out bytes.Buffer
	order := &terminalOutputOrder{write: func(data []byte) error { _, err := out.Write(data); return err }}
	grid := []byte("\x1b]2;webterm-grid:104x36\x07")
	if err := order.grid(grid); err != nil {
		t.Fatal(err)
	}
	version := order.captureVersion()
	accepted, err := order.snapshot([]byte("\x1b]2;webterm-grid:104x31\x07STALE"), version)
	if err != nil || accepted || !bytes.Equal(out.Bytes(), grid) {
		t.Fatal("mismatched capture published")
	}
	// Duplicate layout announcements do not invalidate a coherent quiet frame.
	if err := order.grid(grid); err != nil {
		t.Fatal(err)
	}
	fresh := append(append([]byte(nil), grid...), []byte("FRESH")...)
	accepted, err = order.snapshot(fresh, version)
	want := append(append(append(append([]byte(nil), grid...), grid...), fresh...), grid...)
	if err != nil || !accepted || !bytes.Equal(out.Bytes(), want) {
		t.Fatal("unchanged frame rejected")
	}
}

func TestFreshSnapshotKeepsGeometryAvailableToHistoryReaders(t *testing.T) {
	// A restored history reader deliberately discards attach-snapshot pixels.
	// Its independent history image must still receive the accepted live grid.
	var reader bytes.Buffer
	order := &terminalOutputOrder{write: func(data []byte) error {
		if bytes.Contains(data, []byte("\x1b[2J")) {
			return nil
		}
		_, err := reader.Write(data)
		return err
	}}
	grid := []byte("\x1b]2;webterm-grid:77x34\x07")
	frame := append(append([]byte(nil), grid...), []byte("\x1b[2Jfresh screen")...)
	accepted, err := order.snapshot(frame, order.captureVersion())
	if err != nil || !accepted {
		t.Fatalf("fresh snapshot rejected: %v", err)
	}
	if !bytes.Equal(reader.Bytes(), grid) {
		t.Fatalf("history reader lost authoritative geometry: %q", reader.String())
	}
}
