package handler

import (
	"bytes"
	"sync"
)

// A reconnect capture runs over another SSH channel. It must not leave an
// older screen behind newer live output. A capture is optimistic: any source
// change while its remote read is in flight invalidates the entire frame.
type terminalOutputOrder struct {
	mu         sync.Mutex
	latestGrid []byte
	revision   uint64
	write      func([]byte) error
}

func (o *terminalOutputOrder) output(data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(data) > 0 {
		o.revision++
	}
	return o.write(data)
}

func (o *terminalOutputOrder) grid(data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !bytes.Equal(o.latestGrid, data) {
		o.revision++
		o.latestGrid = append([]byte(nil), data...)
	}
	return o.write(data)
}

func (o *terminalOutputOrder) captureVersion() uint64 {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.revision
}

func (o *terminalOutputOrder) snapshot(data []byte, version uint64) (bool, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if version != o.revision || (len(o.latestGrid) > 0 && !bytes.HasPrefix(data, o.latestGrid)) {
		return false, nil
	}
	end := bytes.IndexByte(data, '\x07')
	if !bytes.HasPrefix(data, []byte("\x1b]2;webterm-grid:")) || end < 0 {
		return false, nil
	}
	if err := o.write(data); err != nil {
		return true, err
	}
	// History readers can discard snapshot pixels while replaying their own
	// capture. Keep geometry independently consumable, but only for an accepted
	// coherent frame: never append new metadata behind rejected stale pixels.
	return true, o.write(data[:end+1])
}
