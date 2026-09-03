package sshmgr

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSessionPoolShardsConcurrentSessionsWithoutExceedingLimits(t *testing.T) {
	pool := NewPool()
	const (
		connID               = int64(42)
		maxSessions          = 100
		channelsPerTransport = 10
	)

	leases := make([]*SessionLease, maxSessions)
	errs := make(chan error, maxSessions)
	var wg sync.WaitGroup
	for i := range leases {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			lease, err := pool.AcquireSession(connID, maxSessions, channelsPerTransport, func() (*Client, error) {
				return &Client{}, nil
			})
			if err != nil {
				errs <- err
				return
			}
			leases[i] = lease
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	if got := pool.ActiveSessionCount(connID); got != maxSessions {
		t.Fatalf("active sessions = %d, want %d", got, maxSessions)
	}
	if got := pool.SessionTransportCount(connID); got != maxSessions/channelsPerTransport {
		t.Fatalf("transport count = %d, want %d", got, maxSessions/channelsPerTransport)
	}
	for _, load := range pool.SessionTransportLoads(connID) {
		if load > channelsPerTransport {
			t.Fatalf("transport load = %d, exceeds %d", load, channelsPerTransport)
		}
	}

	if _, err := pool.AcquireSession(connID, maxSessions, channelsPerTransport, func() (*Client, error) {
		return &Client{}, nil
	}); !errors.Is(err, ErrMaxSessions) {
		t.Fatalf("overflow error = %v, want ErrMaxSessions", err)
	}

	for _, lease := range leases {
		lease.Release()
	}
	if got := pool.ActiveSessionCount(connID); got != 0 {
		t.Fatalf("active sessions after release = %d, want 0", got)
	}
}

func TestSessionPoolBoundsConcurrentTransportDials(t *testing.T) {
	pool := NewPoolWithDialLimit(2)
	var inFlight, peak atomic.Int32
	leases := make([]*SessionLease, 30)
	var wg sync.WaitGroup
	for i := range leases {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			lease, err := pool.AcquireSession(77, 30, 10, func() (*Client, error) {
				current := inFlight.Add(1)
				for {
					old := peak.Load()
					if current <= old || peak.CompareAndSwap(old, current) {
						break
					}
				}
				time.Sleep(20 * time.Millisecond)
				inFlight.Add(-1)
				return &Client{}, nil
			})
			if err != nil {
				t.Errorf("AcquireSession() error = %v", err)
				return
			}
			leases[i] = lease
		}(i)
	}
	wg.Wait()
	if got := peak.Load(); got > 2 {
		t.Fatalf("concurrent transport dials = %d, want at most 2", got)
	}
	for _, lease := range leases {
		lease.Release()
	}
}
