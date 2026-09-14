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

	hub.PublishLayout(101, 8)

	select {
	case event := <-aEvents:
		if event.Type != "layout_revision" || event.Revision != 8 {
			t.Fatalf("user A event = %#v, want layout revision 8", event)
		}
	case <-time.After(time.Second):
		t.Fatal("user A did not receive layout revision")
	}
	select {
	case event := <-bEvents:
		t.Fatalf("user B unexpectedly received event %#v", event)
	case <-time.After(25 * time.Millisecond):
	}
}

func TestLayoutHubKeepsOrderedTypedEventsForActiveClients(t *testing.T) {
	hub := NewLayoutHub()
	events, unsubscribe := hub.Subscribe(101)
	defer unsubscribe()

	hub.PublishLayout(101, 8)
	hub.PublishLayout(101, 9)

	select {
	case event := <-events:
		if event.Revision != 8 {
			t.Fatalf("first queued revision = %d, want 8", event.Revision)
		}
	case <-time.After(time.Second):
		t.Fatal("slow client did not receive a revision")
	}
	select {
	case event := <-events:
		if event.Revision != 9 {
			t.Fatalf("second queued revision = %d, want 9", event.Revision)
		}
	case <-time.After(time.Second):
		t.Fatal("slow client did not receive second revision")
	}
}
