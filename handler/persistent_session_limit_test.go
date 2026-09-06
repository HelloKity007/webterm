package handler

import "testing"

func TestPersistentSessionRegistryCountsUniquePanels(t *testing.T) {
	var registry persistentSessionRegistry
	releaseA, err := registry.acquire("panel-a", 2)
	if err != nil {
		t.Fatal(err)
	}
	releaseA2, err := registry.acquire("panel-a", 2)
	if err != nil {
		t.Fatal(err)
	}
	if got := registry.active(); got != 1 {
		t.Fatalf("active unique panels = %d, want 1", got)
	}
	if _, err := registry.acquire("panel-b", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.acquire("panel-c", 2); err == nil {
		t.Fatal("third unique panel unexpectedly acquired past limit")
	}
	releaseA()
	if got := registry.active(); got != 2 {
		t.Fatalf("active after one attachment closes = %d, want 2", got)
	}
	releaseA2()
	if got := registry.active(); got != 1 {
		t.Fatalf("active after panel closes = %d, want 1", got)
	}
}
