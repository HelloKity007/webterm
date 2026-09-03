package handler

import (
	"testing"
	"time"
)

func TestLayoutHubPublishesOnlyToTheSavingUser(t *testing.T) {
	hub := NewLayoutHub()
	aEvents, unsubscribeA := hub.Subscribe(101)
	defer unsubscribeA()
	bEvents, unsubscribeB := hub.Subscribe(202)
	defer unsubscribeB()

	hub.Publish(101, 8)

	select {
	case revision := <-aEvents:
		if revision != 8 {
			t.Fatalf("user A revision = %d, want 8", revision)
		}
	case <-time.After(time.Second):
		t.Fatal("user A did not receive layout revision")
	}
	select {
	case revision := <-bEvents:
		t.Fatalf("user B unexpectedly received revision %d", revision)
	case <-time.After(25 * time.Millisecond):
	}
}

func TestLayoutHubKeepsOnlyTheNewestRevisionForSlowClients(t *testing.T) {
	hub := NewLayoutHub()
	events, unsubscribe := hub.Subscribe(101)
	defer unsubscribe()

	hub.Publish(101, 8)
	hub.Publish(101, 9)

	select {
	case revision := <-events:
		if revision != 9 {
			t.Fatalf("queued revision = %d, want newest revision 9", revision)
		}
	case <-time.After(time.Second):
		t.Fatal("slow client did not receive a revision")
	}
}
