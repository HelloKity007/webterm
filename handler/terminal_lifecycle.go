package handler

import (
	"errors"
	"sync"
)

// Serialize explicit close against new attachments for the same terminal ID.
// IDs are not reused; retained markers reject stale peer reconnects until restart.
type terminalLifecycle struct {
	mu      sync.Mutex
	entries map[string]*terminalLifecycleEntry
}
type terminalLifecycleEntry struct {
	mu     sync.Mutex
	closed bool
}

func (l *terminalLifecycle) entry(key string) *terminalLifecycleEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.entries == nil {
		l.entries = make(map[string]*terminalLifecycleEntry)
	}
	if l.entries[key] == nil {
		l.entries[key] = &terminalLifecycleEntry{}
	}
	return l.entries[key]
}
func (e *terminalLifecycleEntry) start(run func() error) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return errors.New("terminal was explicitly closed")
	}
	return run()
}
func (e *terminalLifecycleEntry) close(run func() error) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
	return run() // Retry remains possible if SSH cleanup failed previously.
}
