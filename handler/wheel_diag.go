package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
)

type wheelDiagEvent struct {
	ClientTime float64 `json:"client_t"`
	DeltaX     float64 `json:"delta_x"`
	DeltaY     float64 `json:"delta_y"`
	DeltaMode  int     `json:"delta_mode"`
	DeltaMs    float64 `json:"dt_ms"`
	Shift      bool    `json:"shift"`
	Ctrl       bool    `json:"ctrl"`
	Alt        bool    `json:"alt"`
	Meta       bool    `json:"meta"`
	Trusted    bool    `json:"trusted"`
	Alternate  bool    `json:"alternate"`
	TermMode   string  `json:"term_mode"`
	Route      string  `json:"route"`
	Gate       string  `json:"gate"`
	EmitPath   string  `json:"emit_path"`
	TerminalID string  `json:"terminal_id"`
	Platform   string  `json:"platform"`
	Workspace  int     `json:"workspace"`
	Panel      int     `json:"panel"`
}

type wheelDiagEntry struct {
	Seq uint64 `json:"seq"`
	wheelDiagEvent
}

type WheelDiagHandler struct {
	mu      sync.Mutex
	enabled bool
	ring    []wheelDiagEntry
	next    int
	count   int
	seq     uint64
	dropped uint64
}

func (h *WheelDiagHandler) SetEnabled(enabled bool) { h.enabled = enabled }

func (h *WheelDiagHandler) AppendHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.enabled {
		http.NotFound(w, r)
		return
	}
	if r.ContentLength > 64*1024 {
		http.Error(w, "diagnostic batch too large", http.StatusRequestEntityTooLarge)
		return
	}
	var events []wheelDiagEvent
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	if err := decoder.Decode(&events); err != nil || len(events) > 100 {
		http.Error(w, "invalid diagnostic batch", http.StatusBadRequest)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.ring == nil {
		h.ring = make([]wheelDiagEntry, 4096)
	}
	for _, event := range events {
		h.seq++
		if h.count == len(h.ring) {
			h.dropped++
		} else {
			h.count++
		}
		h.ring[h.next] = wheelDiagEntry{Seq: h.seq, wheelDiagEvent: sanitizeWheelDiagEvent(event)}
		h.next = (h.next + 1) % len(h.ring)
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func (h *WheelDiagHandler) SnapshotHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.enabled {
		http.NotFound(w, r)
		return
	}
	limit := 4096
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed < limit {
			limit = parsed
		}
	}
	var since uint64
	if raw := r.URL.Query().Get("since"); raw != "" {
		if parsed, err := strconv.ParseUint(raw, 10, 64); err == nil {
			since = parsed
		}
	}
	h.mu.Lock()
	entries := make([]wheelDiagEntry, 0, h.count)
	if h.count > 0 {
		start := (h.next - h.count + len(h.ring)) % len(h.ring)
		for i := 0; i < h.count; i++ {
			entry := h.ring[(start+i)%len(h.ring)]
			if entry.Seq > since {
				entries = append(entries, entry)
			}
		}
	}
	if len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}
	response := struct {
		Count   int              `json:"count"`
		Dropped uint64           `json:"dropped"`
		Events  []wheelDiagEntry `json:"events"`
	}{Count: len(entries), Dropped: h.dropped, Events: entries}
	clear := r.URL.Query().Get("clear") == "1"
	if clear {
		h.count, h.next, h.dropped = 0, 0, 0
	}
	h.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func sanitizeWheelDiagEvent(event wheelDiagEvent) wheelDiagEvent {
	if len(event.TerminalID) > 64 {
		event.TerminalID = event.TerminalID[:64]
	}
	if len(event.Platform) > 32 {
		event.Platform = event.Platform[:32]
	}
	if event.Workspace < 0 || event.Workspace > 1000 {
		event.Workspace = 0
	}
	if event.Panel < 0 || event.Panel > 1000 {
		event.Panel = 0
	}
	return event
}
