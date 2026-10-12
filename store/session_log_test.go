package store

import (
	"path/filepath"
	"testing"
)

func TestPruneSessionLogsDeletesOldRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.db")
	s, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i := 0; i < 5; i++ {
		if _, err := s.CreateSessionLog(&SessionLog{UserID: 1, ConnectionID: 2, Type: "ssh"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.DB.Exec("UPDATE session_logs SET started_at=datetime('now','-40 days')"); err != nil {
		t.Fatal(err)
	}
	pruned, err := s.PruneSessionLogs(30)
	if err != nil {
		t.Fatal(err)
	}
	if pruned != 5 {
		t.Fatalf("pruned = %d, want 5", pruned)
	}
	var count int
	if err := s.DB.QueryRow("SELECT COUNT(*) FROM session_logs").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("remaining rows = %d, want 0", count)
	}
}

func TestCloseStaleReservations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.db")
	s, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	f := terminalFixture()
	if _, _, err := s.ReserveTerminalInstance(f); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("UPDATE terminal_instances SET created_at=datetime('now','-48 hours') WHERE terminal_id=?", f.TerminalID); err != nil {
		t.Fatal(err)
	}
	closed, err := s.CloseStaleReservations(24)
	if err != nil {
		t.Fatal(err)
	}
	if closed != 1 {
		t.Fatalf("closed = %d, want 1", closed)
	}
	var state string
	if err := s.DB.QueryRow("SELECT state FROM terminal_instances WHERE terminal_id=?", f.TerminalID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "closed" {
		t.Fatalf("state = %q, want closed", state)
	}
}
