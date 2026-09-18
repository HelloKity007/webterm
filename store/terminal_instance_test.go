package store

import (
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

func terminalFixture() TerminalInstance {
	return TerminalInstance{UserID: 1, ConnectionID: 2, TerminalID: "terminal-qa", Environment: "release-test", Host: "localhost", Port: 22, SSHUser: "qa", Socket: "qa-only", CanonicalName: "qa-session"}
}

func TestTerminalReservationAcrossConnectionsAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.db")
	first, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	var winners atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s := first
			if i%2 == 1 {
				s = second
			}
			instance, won, err := s.ReserveTerminalInstance(terminalFixture())
			if err != nil {
				t.Errorf("reserve: %v", err)
				return
			}
			if instance.State != TerminalReserved || instance.Incarnation == "" {
				t.Errorf("bad reservation: %+v", instance)
			}
			if won {
				winners.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatalf("got %d creation winners", winners.Load())
	}
	before, err := first.GetTerminalInstance(1, 2, "terminal-qa")
	if err != nil {
		t.Fatal(err)
	}
	first.Close()
	second.Close()
	reopened, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	after, won, err := reopened.ReserveTerminalInstance(terminalFixture())
	if err != nil {
		t.Fatal(err)
	}
	if won || after.Incarnation != before.Incarnation || after.CreatedAt != before.CreatedAt {
		t.Fatal("restart manufactured creation permission or changed identity")
	}
}

func TestTerminalInstanceCASAndIsolation(t *testing.T) {
	s, err := New(filepath.Join(t.TempDir(), "registry.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	row, won, err := s.ReserveTerminalInstance(terminalFixture())
	if err != nil || !won {
		t.Fatalf("reserve %v %v", won, err)
	}
	changed, err := s.CompareAndSwapTerminalInstanceState(1, 2, "terminal-qa", "wrong", TerminalReserved, TerminalActive)
	if err != nil || changed {
		t.Fatal("wrong incarnation modified row")
	}
	changed, err = s.CompareAndSwapTerminalInstanceState(1, 2, "terminal-qa", row.Incarnation, TerminalMissing, TerminalActive)
	if err != nil || changed {
		t.Fatal("wrong expected state modified row")
	}
	for _, step := range [][2]TerminalInstanceState{{TerminalReserved, TerminalActive}, {TerminalActive, TerminalMissing}, {TerminalMissing, TerminalActive}, {TerminalActive, TerminalClosed}} {
		changed, err = s.CompareAndSwapTerminalInstanceState(1, 2, "terminal-qa", "wrong-incarnation", step[0], step[1])
		if err != nil || changed {
			t.Fatalf("wrong incarnation modified lifecycle step %v", step)
		}
		changed, err = s.CompareAndSwapTerminalInstanceState(1, 2, "terminal-qa", row.Incarnation, step[0], step[1])
		if err != nil || !changed {
			t.Fatalf("CAS %v: %v %v", step, changed, err)
		}
	}
	closed, err := s.GetTerminalInstance(1, 2, "terminal-qa")
	if err != nil {
		t.Fatal(err)
	}
	if closed.State != TerminalClosed || closed.ActivatedAt == nil || closed.MissingAt == nil || closed.ClosedAt == nil {
		t.Fatalf("missing lifecycle evidence: %+v", closed)
	}
	if _, err = s.CompareAndSwapTerminalInstanceState(1, 2, "terminal-qa", row.Incarnation, TerminalClosed, TerminalActive); err == nil {
		t.Fatal("closed tombstone reopened")
	}
	_, won, err = s.ReserveTerminalInstance(terminalFixture())
	if err != nil || won {
		t.Fatal("closed identity granted new creation")
	}
	other := terminalFixture()
	other.UserID = 2
	isolated, won, err := s.ReserveTerminalInstance(other)
	if err != nil || !won || isolated.Incarnation == row.Incarnation {
		t.Fatal("user identities not isolated")
	}
	changed, err = s.CompareAndSwapTerminalInstanceState(2, 2, "terminal-qa", row.Incarnation, TerminalReserved, TerminalActive)
	if err != nil || changed {
		t.Fatal("cross-user incarnation changed state")
	}
	altered := terminalFixture()
	altered.Socket = "different"
	_, won, err = s.ReserveTerminalInstance(altered)
	if won || !errors.Is(err, ErrTerminalIdentityMismatch) {
		t.Fatal("namespace change not rejected")
	}
}

func TestTerminalInstanceEndpointIdentityImmutable(t *testing.T) {
	s, err := New(filepath.Join(t.TempDir(), "registry.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	original, _, err := s.ReserveTerminalInstance(terminalFixture())
	if err != nil {
		t.Fatal(err)
	}
	changes := []func(*TerminalInstance){
		func(v *TerminalInstance) { v.Host = "other" },
		func(v *TerminalInstance) { v.Port = 2222 },
		func(v *TerminalInstance) { v.SSHUser = "other" },
		func(v *TerminalInstance) { v.Environment = "production" },
		func(v *TerminalInstance) { v.Socket = "other" },
		func(v *TerminalInstance) { v.CanonicalName = "renumbered-panel" },
	}
	for _, change := range changes {
		candidate := terminalFixture()
		change(&candidate)
		row, won, err := s.ReserveTerminalInstance(candidate)
		if !errors.Is(err, ErrTerminalIdentityMismatch) || won || row.Incarnation != original.Incarnation {
			t.Fatal("identity mismatch granted permission")
		}
	}
	after, err := s.GetTerminalInstance(1, 2, "terminal-qa")
	if err != nil || *after != *original {
		t.Fatal("rejected identity edits mutated original")
	}
	other := terminalFixture()
	other.ConnectionID = 3
	if _, won, err := s.ReserveTerminalInstance(other); err != nil || !won {
		t.Fatal("connection identities not isolated")
	}
}
