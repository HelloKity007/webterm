package handler

import (
	"errors"
	"io"
	"sync"
	"testing"
	"time"
)

func TestTerminalGeometryOverlappingReload(t *testing.T) {
	var registry terminalGeometryRegistry
	old := registry.attach("terminal", "browser", func(int, int) error { return nil })
	_ = old.resize(30, 120, false)
	writes := 0
	next := registry.attach("terminal", "browser", func(int, int) error { writes++; return nil })
	defer next.release()
	old.release()
	if err := old.resize(40, 180, true); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("superseded socket can resize: %v", err)
	}
	if err := next.resize(30, 120, false); err != nil {
		t.Fatal(err)
	}
	if writes != 1 {
		t.Fatal("stale release invalidated current controller")
	}
}

func TestTerminalGeometryConcurrentTakeovers(t *testing.T) {
	var registry terminalGeometryRegistry
	var wg sync.WaitGroup
	writes := 0 // intentionally not atomic: race detector proves per-terminal serialization
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := registry.attach("terminal", string(rune('a'+i)), func(int, int) error { writes++; return nil })
			defer c.release()
			for n := 0; n < 20; n++ {
				if err := c.resize(30+n, 120+i, true); err != nil {
					t.Error(err)
				}
			}
		}(i)
	}
	wg.Wait()
	if writes < 12 {
		t.Fatalf("lost all control requests: %d", writes)
	}
}

func TestTerminalGeometryOwnership(t *testing.T) {
	var registry terminalGeometryRegistry
	var writes []string
	attach := func(client string) *terminalGeometryClient {
		return registry.attach("terminal-a", client, func(rows, cols int) error { writes = append(writes, client); return nil })
	}
	a := attach("a")
	b := attach("b")
	defer a.release()
	defer b.release()
	if err := a.resize(30, 120, false); err != nil {
		t.Fatal(err)
	}
	if err := b.resize(40, 180, false); err != nil {
		t.Fatal(err)
	}
	if len(writes) != 1 || writes[0] != "a" {
		t.Fatalf("peer stole dimensions: %v", writes)
	}
	if err := b.resize(40, 180, true); err != nil {
		t.Fatal(err)
	}
	if err := a.resize(31, 121, false); err != nil {
		t.Fatal(err)
	}
	if len(writes) != 2 || writes[1] != "b" {
		t.Fatalf("explicit takeover failed: %v", writes)
	}
}

func TestTerminalGeometryReconnectAndExpiry(t *testing.T) {
	var registry terminalGeometryRegistry
	var writes []string
	attach := func(id string) *terminalGeometryClient {
		return registry.attach("a", id, func(int, int) error { writes = append(writes, id); return nil })
	}
	a := attach("owner")
	b := attach("peer")
	defer b.release()
	_ = a.resize(30, 120, false)
	_ = b.resize(40, 180, false)
	a.release()
	_ = b.resize(41, 180, false)
	if len(writes) != 1 {
		t.Fatal("disconnect immediately transferred ownership")
	}
	restored := attach("owner")
	_ = restored.resize(30, 120, false)
	a.release() // a stale connection must not release its replacement
	_ = b.resize(42, 180, false)
	if len(writes) != 2 {
		t.Fatalf("reconnect failed: %v", writes)
	}
	restored.release()
	b.entry.expire(time.Now().Add(16 * time.Second))
	if len(writes) != 3 || writes[2] != "peer" {
		t.Fatalf("grace expiry did not apply waiting peer size: %v", writes)
	}
}

func TestTerminalGeometryFailureAndIsolation(t *testing.T) {
	var registry terminalGeometryRegistry
	calls := 0
	a := registry.attach("a", "browser", func(int, int) error {
		calls++
		if calls == 1 {
			return errors.New("write failed")
		}
		return nil
	})
	defer a.release()
	if a.resize(30, 150, false) == nil {
		t.Fatal("lost resize error")
	}
	if err := a.resize(30, 150, false); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("failed resize was incorrectly deduplicated")
	}
	otherCalls := 0
	b := registry.attach("b", "another", func(int, int) error { otherCalls++; return nil })
	defer b.release()
	_ = b.resize(40, 180, false)
	if otherCalls != 1 {
		t.Fatal("terminal keys share ownership")
	}
}
