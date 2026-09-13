package handler

import "sync"

// A reconnect capture runs over another SSH channel. It must not leave an
// older grid announcement behind a newer live layout notification.
type terminalOutputOrder struct {
	mu         sync.Mutex
	latestGrid []byte
	write      func([]byte) error
}

func (o *terminalOutputOrder) output(data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.write(data)
}

func (o *terminalOutputOrder) grid(data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.latestGrid = append([]byte(nil), data...)
	return o.write(data)
}

func (o *terminalOutputOrder) snapshot(data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if err := o.write(data); err != nil {
		return err
	}
	if len(o.latestGrid) > 0 {
		return o.write(o.latestGrid)
	}
	return nil
}
