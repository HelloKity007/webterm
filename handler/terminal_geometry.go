package handler

import (
	"io"
	"sync"
	"time"
)

const terminalGeometryGrace = 15 * time.Second

// Entries are scoped to an authenticated terminal key, like terminalLifecycle.
// Network writes are serialized per terminal, never under the registry lock.
type terminalGeometryRegistry struct {
	mu      sync.Mutex
	entries map[string]*terminalGeometryEntry
}
type terminalGeometryEntry struct {
	mu      sync.Mutex
	clients []*terminalGeometryClient
	owner   string
	until   time.Time
	timer   *time.Timer
}
type terminalGeometryClient struct {
	entry                    *terminalGeometryEntry
	id                       string
	active                   bool
	rows, cols               int
	appliedRows, appliedCols int
	write                    func(int, int) error
}

func (r *terminalGeometryRegistry) attach(key, id string, write func(int, int) error) *terminalGeometryClient {
	r.mu.Lock()
	if r.entries == nil {
		r.entries = make(map[string]*terminalGeometryEntry)
	}
	e := r.entries[key]
	if e == nil {
		e = &terminalGeometryEntry{}
		r.entries[key] = e
	}
	r.mu.Unlock()
	e.mu.Lock()
	defer e.mu.Unlock()
	// A reload may overlap its previous socket. Only its newest attachment can resize.
	for i := len(e.clients) - 1; i >= 0; i-- {
		if e.clients[i].id == id {
			e.clients[i].active = false
			e.clients = append(e.clients[:i], e.clients[i+1:]...)
		}
	}
	c := &terminalGeometryClient{entry: e, id: id, active: true, write: write}
	e.clients = append(e.clients, c)
	if e.owner == id {
		e.until = time.Time{}
		if e.timer != nil {
			e.timer.Stop()
			e.timer = nil
		}
	}
	return c
}

func (c *terminalGeometryClient) applyLocked() error {
	if c.rows == 0 || c.cols == 0 || (c.rows == c.appliedRows && c.cols == c.appliedCols) {
		return nil
	}
	if err := c.write(c.rows, c.cols); err != nil {
		return err
	}
	c.appliedRows, c.appliedCols = c.rows, c.cols
	return nil
}

func (c *terminalGeometryClient) resize(rows, cols int, takeover bool) error {
	e := c.entry
	e.mu.Lock()
	defer e.mu.Unlock()
	if !c.active {
		return io.ErrClosedPipe
	}
	c.rows, c.cols = rows, cols
	if e.owner == "" || takeover || (!e.until.IsZero() && !time.Now().Before(e.until)) {
		if e.owner != c.id {
			c.appliedRows, c.appliedCols = 0, 0
		}
		e.owner = c.id
		e.until = time.Time{}
		if e.timer != nil {
			e.timer.Stop()
			e.timer = nil
		}
	}
	if e.owner != c.id {
		return nil
	}
	return c.applyLocked()
}

func (c *terminalGeometryClient) release() {
	e := c.entry
	e.mu.Lock()
	defer e.mu.Unlock()
	if !c.active {
		return
	}
	c.active = false
	for i, client := range e.clients {
		if client == c {
			e.clients = append(e.clients[:i], e.clients[i+1:]...)
			break
		}
	}
	if e.owner == c.id {
		e.until = time.Now().Add(terminalGeometryGrace)
		if e.timer != nil {
			e.timer.Stop()
		}
		e.timer = time.AfterFunc(terminalGeometryGrace, func() { e.expire(time.Now()) })
	}
}

func (c *terminalGeometryClient) takeControl() error {
	c.entry.mu.Lock()
	rows, cols := c.rows, c.cols
	c.entry.mu.Unlock()
	if rows == 0 || cols == 0 {
		return nil
	}
	return c.resize(rows, cols, true)
}

func (e *terminalGeometryEntry) expire(now time.Time) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.until.IsZero() || now.Before(e.until) {
		return
	}
	if e.timer != nil {
		e.timer.Stop()
		e.timer = nil
	}
	e.owner = ""
	e.until = time.Time{}
	for _, c := range e.clients {
		if c.rows == 0 {
			continue
		}
		c.appliedRows, c.appliedCols = 0, 0
		if err := c.applyLocked(); err != nil {
			continue
		}
		e.owner = c.id
		break
	}
}

type geometryTerminalSession struct {
	terminalInputSession
	geometry *terminalGeometryClient
}

func (s *geometryTerminalSession) WindowChange(rows, cols int) error {
	return s.geometry.resize(rows, cols, false)
}
func (s *geometryTerminalSession) Close() error {
	s.geometry.release()
	return s.terminalInputSession.Close()
}
