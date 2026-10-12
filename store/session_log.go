package store

import (
	"strconv"
	"time"
)

type SessionLog struct {
	ID           int64      `json:"id"`
	UserID       int64      `json:"user_id"`
	ConnectionID int64      `json:"connection_id"`
	Type         string     `json:"type"`
	StartedAt    time.Time  `json:"started_at"`
	EndedAt      *time.Time `json:"ended_at"`
}

func (s *Store) CreateSessionLog(log *SessionLog) (int64, error) {
	res, err := s.DB.Exec(
		"INSERT INTO session_logs (user_id, connection_id, type) VALUES (?, ?, ?)",
		log.UserID, log.ConnectionID, log.Type,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) EndSessionLog(id int64) error {
	_, err := s.DB.Exec("UPDATE session_logs SET ended_at=CURRENT_TIMESTAMP WHERE id=?", id)
	return err
}

// PruneSessionLogs deletes session-log rows older than retentionDays and
// reclaims the space. It runs once at startup so the table cannot grow
// without bound across weeks of terminal use.
func (s *Store) PruneSessionLogs(retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		return 0, nil
	}
	res, err := s.DB.Exec(
		"DELETE FROM session_logs WHERE started_at < datetime('now', ?)",
		"-"+strconv.Itoa(retentionDays)+" days",
	)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		_, _ = s.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	}
	return n, nil
}

// CloseStaleReservations marks terminal instances stuck in the reserved
// state for more than the given number of hours as closed, so failed
// creations cannot leak reservations forever.
func (s *Store) CloseStaleReservations(hours int) (int64, error) {
	if hours <= 0 {
		return 0, nil
	}
	res, err := s.DB.Exec(
		"UPDATE terminal_instances SET state='closed' WHERE state='reserved' AND created_at < datetime('now', ?)",
		"-"+strconv.Itoa(hours)+" hours",
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// CheckpointWAL truncates the write-ahead log after bulk deletions so the
// database image on disk stays compact.
func (s *Store) CheckpointWAL() error {
	_, err := s.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
