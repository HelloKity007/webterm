package sshmgr

import (
	"errors"
	"sync"
	"time"
)

var ErrMaxSessions = errors.New("ssh session limit reached")
var ErrTransportDead = errors.New("ssh transport keepalive failed")

// MaxChannelsPerTransport matches OpenSSH's default MaxSessions. More active
// terminal panes are sharded across transports instead of overfilling one.
const MaxChannelsPerTransport = 10

const defaultTransportDialLimit = 8

type poolEntry struct {
	client   *Client
	refCount int
}

type sessionPoolEntry struct {
	slots  []*sessionSlot
	active int
}

type sessionSlot struct {
	client   *Client
	sessions int
	ready    chan struct{}
	err      error
	dead     bool
	stop     chan struct{}
	stopOnce sync.Once
}

type Pool struct {
	mu             sync.Mutex
	entries        map[int64]*poolEntry
	sessionEntries map[int64]*sessionPoolEntry
	dialGate       chan struct{}
	keepaliveEvery time.Duration
	keepaliveLimit int
	probeAlive     func(*Client) bool
}

func NewPool() *Pool {
	return NewPoolWithDialLimit(defaultTransportDialLimit)
}

func NewPoolWithDialLimit(limit int) *Pool {
	if limit < 1 {
		limit = 1
	}
	return &Pool{
		entries:        make(map[int64]*poolEntry),
		sessionEntries: make(map[int64]*sessionPoolEntry),
		dialGate:       make(chan struct{}, limit),
		keepaliveEvery: 20 * time.Second,
		keepaliveLimit: 3,
		probeAlive:     func(client *Client) bool { return client.IsAlive() },
	}
}

// SessionLease owns one SSH channel reservation. It must be released exactly
// once when the browser WebSocket closes.
type SessionLease struct {
	pool   *Pool
	connID int64
	entry  *sessionPoolEntry
	slot   *sessionSlot
	Client *Client
	once   sync.Once
}

func (l *SessionLease) Release() {
	if l == nil {
		return
	}
	l.once.Do(func() { l.pool.releaseSession(l.connID, l.entry, l.slot) })
}

// AcquireSession reserves one channel without letting any individual SSH
// transport exceed channelsPerTransport. maxSessions remains the connection's
// total user-visible limit, irrespective of how many transports are needed.
func (p *Pool) AcquireSession(connID int64, maxSessions, channelsPerTransport int, factory func() (*Client, error)) (*SessionLease, error) {
	if channelsPerTransport < 1 {
		channelsPerTransport = 1
	}

	p.mu.Lock()
	entry := p.sessionEntries[connID]
	if entry == nil {
		entry = &sessionPoolEntry{}
		p.sessionEntries[connID] = entry
	}
	if maxSessions > 0 && entry.active >= maxSessions {
		p.mu.Unlock()
		return nil, ErrMaxSessions
	}

	for _, slot := range entry.slots {
		if !slot.dead && slot.sessions < channelsPerTransport {
			slot.sessions++
			entry.active++
			p.mu.Unlock()
			return p.awaitSession(connID, entry, slot)
		}
	}

	slot := &sessionSlot{sessions: 1, ready: make(chan struct{}), stop: make(chan struct{})}
	entry.slots = append(entry.slots, slot)
	entry.active++
	p.mu.Unlock()

	p.dialGate <- struct{}{}
	client, err := factory()
	<-p.dialGate
	p.mu.Lock()
	slot.client = client
	slot.err = err
	close(slot.ready)
	p.mu.Unlock()
	if err != nil {
		p.releaseSession(connID, entry, slot)
		return nil, err
	}
	go p.monitorSessionTransport(slot)
	return &SessionLease{pool: p, connID: connID, entry: entry, slot: slot, Client: client}, nil
}

func (p *Pool) awaitSession(connID int64, entry *sessionPoolEntry, slot *sessionSlot) (*SessionLease, error) {
	<-slot.ready
	p.mu.Lock()
	err := slot.err
	client := slot.client
	dead := slot.dead
	p.mu.Unlock()
	if err != nil {
		p.releaseSession(connID, entry, slot)
		return nil, err
	}
	if dead {
		p.releaseSession(connID, entry, slot)
		return nil, ErrTransportDead
	}
	return &SessionLease{pool: p, connID: connID, entry: entry, slot: slot, Client: client}, nil
}

func (p *Pool) releaseSession(connID int64, entry *sessionPoolEntry, slot *sessionSlot) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if slot.sessions == 0 {
		return
	}
	slot.sessions--
	entry.active--
	if slot.sessions != 0 {
		return
	}
	if slot.stop != nil {
		slot.stopOnce.Do(func() { close(slot.stop) })
	}
	if slot.client != nil {
		_ = slot.client.Close()
	}
	for i, candidate := range entry.slots {
		if candidate == slot {
			entry.slots = append(entry.slots[:i], entry.slots[i+1:]...)
			break
		}
	}
	if entry.active == 0 && len(entry.slots) == 0 && p.sessionEntries[connID] == entry {
		delete(p.sessionEntries, connID)
	}
}

func (p *Pool) monitorSessionTransport(slot *sessionSlot) {
	ticker := time.NewTicker(p.keepaliveEvery)
	defer ticker.Stop()
	failures := 0
	for {
		select {
		case <-slot.stop:
			return
		case <-ticker.C:
			if p.probeAlive(slot.client) {
				failures = 0
				continue
			}
			failures++
			if failures < p.keepaliveLimit {
				continue
			}
			p.mu.Lock()
			slot.dead = true
			p.mu.Unlock()
			_ = slot.client.Close()
			return
		}
	}
}

func (p *Pool) ActiveSessionCount(connID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if entry := p.sessionEntries[connID]; entry != nil {
		return entry.active
	}
	return 0
}

func (p *Pool) SessionTransportCount(connID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if entry := p.sessionEntries[connID]; entry != nil {
		return len(entry.slots)
	}
	return 0
}

func (p *Pool) SessionTransportLoads(connID int64) []int {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry := p.sessionEntries[connID]
	if entry == nil {
		return nil
	}
	loads := make([]int, len(entry.slots))
	for i, slot := range entry.slots {
		loads[i] = slot.sessions
	}
	return loads
}

// Acquire returns an existing client and increments its ref count.
// Does NOT probe liveness (keepalive) to avoid false-positive disconnects.
func (p *Pool) Acquire(connID int64) (*Client, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.entries[connID]
	if ok && e.client.RawConn() != nil {
		e.refCount++
		return e.client, true
	}
	return nil, false
}

// Add inserts a new client with ref count 1.
func (p *Pool) Add(connID int64, c *Client) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.entries[connID] = &poolEntry{client: c, refCount: 1}
}

// AcquireOrCreate atomically acquires an existing client or creates a new one.
// The factory is called outside the lock to avoid blocking other connection IDs.
func (p *Pool) AcquireOrCreate(connID int64, factory func() (*Client, error)) (*Client, error) {
	p.mu.Lock()
	e, ok := p.entries[connID]
	if ok && e.client.RawConn() != nil {
		e.refCount++
		p.mu.Unlock()
		return e.client, nil
	}
	if ok {
		delete(p.entries, connID)
	}
	p.mu.Unlock()

	client, err := factory()
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	// Double-check: another goroutine might have created one while we were connecting
	e, ok = p.entries[connID]
	if ok && e.client.RawConn() != nil {
		client.Close()
		e.refCount++
		p.mu.Unlock()
		return e.client, nil
	}
	p.entries[connID] = &poolEntry{client: client, refCount: 1}
	p.mu.Unlock()
	return client, nil
}

// SessionCount returns the current number of active sessions (ref count) for a connId.
func (p *Pool) SessionCount(connID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.entries[connID]
	if !ok {
		return 0
	}
	return e.refCount
}

// Remove deletes the pool entry without closing the client (used on credential update).
// Active sessions keep using the old connection; new sessions will re-authenticate.
func (p *Pool) Remove(connID int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.entries, connID)
	// Existing terminal leases retain their transport until their WebSocket
	// closes. Future sessions use a fresh entry with the updated credentials.
	delete(p.sessionEntries, connID)
}

func (p *Pool) Release(connID int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.entries[connID]
	if !ok {
		return
	}
	e.refCount--
	if e.refCount <= 0 {
		e.client.Close()
		delete(p.entries, connID)
	}
}
