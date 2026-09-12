package handler

import (
	"encoding/base64"
	"errors"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/net/websocket"
)

const wsOutboundQueueSize = 256
const wsActivityTimeout = 45 * time.Second
const wsWriteTimeout = 10 * time.Second

var (
	errWSOutboundClosed   = errors.New("websocket outbound pump closed")
	errWSOutboundOverflow = errors.New("websocket outbound queue exceeded budget")
)

type wsOutboundMessage struct {
	value any
	done  chan error
}

// wsOutbound is the only goroutine allowed to write frames to a connection.
// The bounded queue deliberately closes slow consumers instead of dropping
// terminal bytes, which could split a VT escape sequence and corrupt output.
type wsOutbound struct {
	conn     *websocket.Conn
	queue    chan wsOutboundMessage
	done     chan struct{}
	once     sync.Once
	registry *WSRegistry
}

func newWSOutbound(conn *websocket.Conn, registries ...*WSRegistry) *wsOutbound {
	out := &wsOutbound{
		conn:  conn,
		queue: make(chan wsOutboundMessage, wsOutboundQueueSize),
		done:  make(chan struct{}),
	}
	if len(registries) > 0 {
		out.registry = registries[0]
	}
	go out.run()
	if out.registry != nil && !out.registry.register(out) {
		out.Close()
	}
	return out
}

func (o *wsOutbound) run() {
	for {
		select {
		case <-o.done:
			return
		case message := <-o.queue:
			_ = o.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			err := websocket.JSON.Send(o.conn, message.value)
			message.done <- err
			if err != nil {
				o.Close()
				return
			}
		}
	}
}

func (o *wsOutbound) Send(value any) error {
	message := wsOutboundMessage{value: value, done: make(chan error, 1)}
	select {
	case <-o.done:
		return errWSOutboundClosed
	case o.queue <- message:
	default:
		o.Close()
		return errWSOutboundOverflow
	}
	select {
	case err := <-message.done:
		return err
	case <-o.done:
		select {
		case err := <-message.done:
			return err
		default:
			return errWSOutboundClosed
		}
	}
}

func (o *wsOutbound) Close() {
	o.once.Do(func() {
		close(o.done)
		_ = o.conn.Close()
		if o.registry != nil {
			o.registry.unregister(o)
		}
	})
}

// WSRegistry lets the HTTP server notify clients before a deploy/restart. A
// shutdown only detaches browser sockets; remote tmux sessions remain alive.
type WSRegistry struct {
	mu       sync.Mutex
	outbound map[*wsOutbound]struct{}
	shutting bool
}

func NewWSRegistry() *WSRegistry {
	return &WSRegistry{outbound: make(map[*wsOutbound]struct{})}
}

func (r *WSRegistry) register(outbound *wsOutbound) bool {
	if r == nil {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.shutting {
		return false
	}
	r.outbound[outbound] = struct{}{}
	return true
}

func (r *WSRegistry) unregister(outbound *wsOutbound) {
	if r == nil {
		return
	}
	r.mu.Lock()
	delete(r.outbound, outbound)
	r.mu.Unlock()
}

func (r *WSRegistry) Shutdown() {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.shutting = true
	connections := make([]*wsOutbound, 0, len(r.outbound))
	for outbound := range r.outbound {
		connections = append(connections, outbound)
	}
	r.mu.Unlock()
	var wait sync.WaitGroup
	for _, outbound := range connections {
		wait.Add(1)
		go func(outbound *wsOutbound) {
			defer wait.Done()
			_ = outbound.Send(map[string]string{"type": "shutdown"})
			outbound.Close()
		}(outbound)
	}
	done := make(chan struct{})
	go func() { wait.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		for _, outbound := range connections {
			outbound.Close()
		}
	}
}

func receiveWebSocketJSON(conn *websocket.Conn, value any) error {
	_ = conn.SetReadDeadline(time.Now().Add(wsActivityTimeout))
	return websocket.JSON.Receive(conn, value)
}

type wsWriter struct {
	outbound *wsOutbound
}

func (w *wsWriter) Write(p []byte) (int, error) {
	msg := map[string]interface{}{"data": string(p)}
	if !utf8.Valid(p) {
		msg["data"] = base64.StdEncoding.EncodeToString(p)
		msg["b64"] = true
	}
	if err := w.outbound.Send(msg); err != nil {
		return 0, err
	}
	return len(p), nil
}
