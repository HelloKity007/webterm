package handler

import (
	"errors"
	"testing"
)

func TestTerminalLifecycleBlocksReconnectAndAllowsCloseRetry(t *testing.T) {
	var registry terminalLifecycle
	first := registry.entry("first")
	if err := first.start(func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	_ = first.close(func() error { return errors.New("SSH unavailable") })
	called := false
	if err := first.start(func() error { called = true; return nil }); err == nil || called {
		t.Fatal("closed terminal reattached")
	}
	if err := first.close(func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := registry.entry("other").start(func() error { return nil }); err != nil {
		t.Fatal("unrelated terminal blocked")
	}
}
