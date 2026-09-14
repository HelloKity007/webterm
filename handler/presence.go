package handler

import (
	"sync"
	"time"
)

type presenceKey struct {
	userID     int64
	terminalID string
	clientID   string
}

type presenceEntry struct {
	references int
	timer      *time.Timer
}

// PresenceRegistry counts distinct browser-tab clients, not sockets. A short
// grace period prevents a normal websocket reconnect from flashing 0 -> 2 -> 1.
type PresenceRegistry struct {
	mu      sync.Mutex
	entries map[presenceKey]*presenceEntry
	grace   time.Duration
	hub     *LayoutHub
}

func NewPresenceRegistry(hub *LayoutHub) *PresenceRegistry {
	return &PresenceRegistry{entries: make(map[presenceKey]*presenceEntry), grace: 15 * time.Second, hub: hub}
}

func (r *PresenceRegistry) Register(userID int64, terminalID, clientID string) func() {
	if r == nil || userID < 1 || terminalID == "" || clientID == "" {
		return func() {}
	}
	key := presenceKey{userID: userID, terminalID: terminalID, clientID: clientID}
	r.mu.Lock()
	entry := r.entries[key]
	wasPresent := entry != nil
	if entry == nil {
		entry = &presenceEntry{}
		r.entries[key] = entry
	}
	if entry.timer != nil {
		entry.timer.Stop()
		entry.timer = nil
	}
	entry.references++
	count := r.countLocked(userID, terminalID)
	r.mu.Unlock()
	if !wasPresent && r.hub != nil {
		r.hub.PublishPresence(userID, terminalID, count)
	}

	var once sync.Once
	return func() {
		once.Do(func() { r.release(key) })
	}
}

func (r *PresenceRegistry) release(key presenceKey) {
	r.mu.Lock()
	entry := r.entries[key]
	if entry == nil {
		r.mu.Unlock()
		return
	}
	if entry.references > 0 {
		entry.references--
	}
	if entry.references > 0 || entry.timer != nil {
		r.mu.Unlock()
		return
	}
	entry.timer = time.AfterFunc(r.grace, func() { r.expire(key, entry) })
	r.mu.Unlock()
}

func (r *PresenceRegistry) expire(key presenceKey, expected *presenceEntry) {
	r.mu.Lock()
	entry := r.entries[key]
	if entry != expected || entry.references > 0 {
		r.mu.Unlock()
		return
	}
	delete(r.entries, key)
	count := r.countLocked(key.userID, key.terminalID)
	r.mu.Unlock()
	if r.hub != nil {
		r.hub.PublishPresence(key.userID, key.terminalID, count)
	}
}

func (r *PresenceRegistry) Snapshot(userID int64) map[string]int {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make(map[string]int)
	for key := range r.entries {
		if key.userID == userID {
			result[key.terminalID]++
		}
	}
	return result
}

func (r *PresenceRegistry) countLocked(userID int64, terminalID string) int {
	count := 0
	for key := range r.entries {
		if key.userID == userID && key.terminalID == terminalID {
			count++
		}
	}
	return count
}
