package handler

import "sync"

// terminalHistory keeps a bounded byte-level transcript for one persistent
// terminal key. It is deliberately transport-agnostic: callers may replay it
// into a fresh xterm without exposing tmux/session names to the browser.
type terminalHistory struct {
	mu      sync.Mutex
	maxSize int
	data    []byte
}

func newTerminalHistory(maxSize int) *terminalHistory {
	if maxSize < 1 {
		maxSize = 1
	}
	return &terminalHistory{maxSize: maxSize}
}

func (h *terminalHistory) appendBytes(data []byte) {
	if h == nil || len(data) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(data) >= h.maxSize {
		h.data = append(h.data[:0], data[len(data)-h.maxSize:]...)
		return
	}
	needed := len(h.data) + len(data) - h.maxSize
	if needed > 0 {
		h.data = append(h.data[:0], h.data[needed:]...)
	}
	h.data = append(h.data, data...)
}

func (h *terminalHistory) snapshot() []byte {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]byte(nil), h.data...)
}

type terminalHistoryStore struct {
	mu      sync.Mutex
	maxSize int
	items   map[string]*terminalHistory
}

func newTerminalHistoryStore(maxSize int) *terminalHistoryStore {
	return &terminalHistoryStore{maxSize: maxSize, items: make(map[string]*terminalHistory)}
}

func (s *terminalHistoryStore) get(key string) *terminalHistory {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if item := s.items[key]; item != nil {
		return item
	}
	item := newTerminalHistory(s.maxSize)
	s.items[key] = item
	return item
}
