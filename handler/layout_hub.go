package handler

import "sync"

type ControlEvent struct {
	Type       string         `json:"type"`
	Revision   int64          `json:"revision,omitempty"`
	Terminals  map[string]int `json:"terminals"`
	TerminalID string         `json:"terminalId,omitempty"`
	Online     int            `json:"online"`
}

// LayoutHub publishes only revision metadata. Clients fetch the authoritative
// layout through the existing authorized GET endpoint, keeping event fan-out
// bounded even for large layouts.
type LayoutHub struct {
	mu          sync.Mutex
	subscribers map[int64]map[chan ControlEvent]struct{}
}

func NewLayoutHub() *LayoutHub {
	return &LayoutHub{subscribers: make(map[int64]map[chan ControlEvent]struct{})}
}

func (h *LayoutHub) Subscribe(userID int64) (<-chan ControlEvent, func()) {
	events := make(chan ControlEvent, 64)
	h.mu.Lock()
	if h.subscribers[userID] == nil {
		h.subscribers[userID] = make(map[chan ControlEvent]struct{})
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

func (h *LayoutHub) publish(userID int64, event ControlEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for events := range h.subscribers[userID] {
		select {
		case events <- event:
		default:
			// A slow control client is safer to reconnect and receive a fresh
			// snapshot than to observe a partial presence stream.
			close(events)
			delete(h.subscribers[userID], events)
		}
	}
}

func (h *LayoutHub) PublishLayout(userID, revision int64) {
	h.publish(userID, ControlEvent{Type: "layout_revision", Revision: revision})
}

func (h *LayoutHub) PublishPresence(userID int64, terminalID string, online int) {
	h.publish(userID, ControlEvent{Type: "presence_delta", TerminalID: terminalID, Online: online})
}
