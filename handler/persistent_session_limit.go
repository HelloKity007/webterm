package handler

import (
	"errors"
	"sync"
)

const persistentTerminalSessionLimit = 100

var errPersistentTerminalSessionLimit = errors.New("persistent terminal session limit reached")

// Counts unique tmux panels, not browser websocket channels. Multiple PCs
// may attach to one panel without consuming additional panel capacity.
type persistentSessionRegistry struct {
	mu   sync.Mutex
	refs map[string]int
}

func (r *persistentSessionRegistry) acquire(key string, limit int) (func(), error) {
	if limit < 1 {
		limit = persistentTerminalSessionLimit
	}
	r.mu.Lock()
	if r.refs == nil {
		r.refs = make(map[string]int)
	}
	if r.refs[key] == 0 && len(r.refs) >= limit {
		r.mu.Unlock()
		return nil, errPersistentTerminalSessionLimit
	}
	r.refs[key]++
	r.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			if count := r.refs[key]; count <= 1 {
				delete(r.refs, key)
			} else {
				r.refs[key] = count - 1
			}
		})
	}, nil
}

func (r *persistentSessionRegistry) active() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.refs)
}
