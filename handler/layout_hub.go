package handler

import "sync"

// LayoutHub publishes only revision metadata. Clients fetch the authoritative
// layout through the existing authorized GET endpoint, keeping event fan-out
// bounded even for large layouts.
type LayoutHub struct {
	mu          sync.Mutex
	subscribers map[int64]map[chan int64]struct{}
}

func NewLayoutHub() *LayoutHub {
	return &LayoutHub{subscribers: make(map[int64]map[chan int64]struct{})}
}

func (h *LayoutHub) Subscribe(userID int64) (<-chan int64, func()) {
	events := make(chan int64, 1)
	h.mu.Lock()
	if h.subscribers[userID] == nil {
		h.subscribers[userID] = make(map[chan int64]struct{})
	}
	h.subscribers[userID][events] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	return events, func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			delete(h.subscribers[userID], events)
			if len(h.subscribers[userID]) == 0 {
				delete(h.subscribers, userID)
			}
		})
	}
}

func (h *LayoutHub) Publish(userID, revision int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for events := range h.subscribers[userID] {
		// A blocked browser needs only the latest revision: the layout itself is
		// loaded from the authoritative GET endpoint after it drains this slot.
		select {
		case <-events:
		default:
		}
		select {
		case events <- revision:
		default:
		}
	}
}
