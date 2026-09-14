package handler

import (
	"testing"
	"time"
)

func TestPresenceCountsDistinctClientsAndHonorsReconnectGrace(t *testing.T) {
	hub := NewLayoutHub()
	registry := NewPresenceRegistry(hub)
	registry.grace = 20 * time.Millisecond
	events, unsubscribe := hub.Subscribe(7)
	defer unsubscribe()

	releaseA1 := registry.Register(7, "terminal-a", "client-a")
	releaseA2 := registry.Register(7, "terminal-a", "client-a")
	releaseB := registry.Register(7, "terminal-a", "client-b")
	if got := registry.Snapshot(7)["terminal-a"]; got != 2 {
		t.Fatalf("online = %d, want two distinct clients", got)
	}
	releaseA1()
	releaseA2()
	time.Sleep(5 * time.Millisecond)
	releaseReconnect := registry.Register(7, "terminal-a", "client-a")
	time.Sleep(30 * time.Millisecond)
	if got := registry.Snapshot(7)["terminal-a"]; got != 2 {
		t.Fatalf("online after reconnect = %d, want 2", got)
	}
	releaseReconnect()
	releaseB()
	time.Sleep(30 * time.Millisecond)
	if got := registry.Snapshot(7)["terminal-a"]; got != 0 {
		t.Fatalf("online after grace = %d, want 0", got)
	}

	seenTwo, seenZero := false, false
	for {
		select {
		case event := <-events:
			seenTwo = seenTwo || event.TerminalID == "terminal-a" && event.Online == 2
			seenZero = seenZero || event.TerminalID == "terminal-a" && event.Online == 0
		default:
			if !seenTwo || !seenZero {
				t.Fatalf("presence events missing: two=%t zero=%t", seenTwo, seenZero)
			}
			return
		}
	}
}

func TestPresenceIsIsolatedByUser(t *testing.T) {
	registry := NewPresenceRegistry(nil)
	releaseA := registry.Register(1, "shared-id", "client")
	defer releaseA()
	releaseB := registry.Register(2, "shared-id", "client")
	defer releaseB()
	if registry.Snapshot(1)["shared-id"] != 1 || registry.Snapshot(2)["shared-id"] != 1 {
		t.Fatalf("presence leaked across users: %#v %#v", registry.Snapshot(1), registry.Snapshot(2))
	}
}
