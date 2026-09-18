package store

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type TerminalInstanceState string

const (
	TerminalReserved TerminalInstanceState = "reserved"
	TerminalActive   TerminalInstanceState = "active"
	TerminalMissing  TerminalInstanceState = "missing"
	TerminalClosed   TerminalInstanceState = "closed"
)

var ErrTerminalIdentityMismatch = errors.New("terminal endpoint or namespace identity mismatch")

// TerminalInstance is durable identity, not proof that a remote process is live.
// Credentials and presentation-only panel numbers deliberately are not stored.
// Socket is an explicit canonical namespace, never an empty/default inference.
// Callers must normalize the legacy default tmux socket to a stable identifier
// (for example "default") before reservation and all subsequent comparisons.
type TerminalInstance struct {
	UserID        int64
	ConnectionID  int64
	TerminalID    string
	Environment   string
	Host          string
	Port          int
	SSHUser       string
	Socket        string
	CanonicalName string
	Incarnation   string
	State         TerminalInstanceState
	CreatedAt     time.Time
	UpdatedAt     time.Time
	ActivatedAt   *time.Time
	MissingAt     *time.Time
	ClosedAt      *time.Time
}

func (s *Store) GetTerminalInstance(userID, connectionID int64, terminalID string) (*TerminalInstance, error) {
	row := &TerminalInstance{}
	var activated, missing, closed sql.NullTime
	err := s.DB.QueryRow(`SELECT user_id,connection_id,terminal_id,environment,host,port,ssh_user,socket,canonical_name,incarnation,state,created_at,updated_at,activated_at,missing_at,closed_at
 FROM terminal_instances WHERE user_id=? AND connection_id=? AND terminal_id=?`, userID, connectionID, terminalID).Scan(&row.UserID, &row.ConnectionID, &row.TerminalID, &row.Environment, &row.Host, &row.Port, &row.SSHUser, &row.Socket, &row.CanonicalName, &row.Incarnation, &row.State, &row.CreatedAt, &row.UpdatedAt, &activated, &missing, &closed)
	if err != nil {
		return nil, err
	}
	if activated.Valid {
		row.ActivatedAt = &activated.Time
	}
	if missing.Valid {
		row.MissingAt = &missing.Time
	}
	if closed.Valid {
		row.ClosedAt = &closed.Time
	}
	return row, nil
}

// ReserveTerminalInstance commits a new identity before any remote creation.
// Only this call's successful INSERT can return won=true. Reading a reserved
// record or repeating a call (including after restart) never grants permission.
// Authorization and explicit user intent must be checked by the caller; layout
// membership and this registry alone cannot provide creation authorization.
func (s *Store) ReserveTerminalInstance(candidate TerminalInstance) (*TerminalInstance, bool, error) {
	if candidate.UserID <= 0 || candidate.ConnectionID <= 0 || candidate.Port < 1 || candidate.Port > 65535 || candidate.Incarnation != "" || candidate.State != "" {
		return nil, false, errors.New("invalid terminal reservation")
	}
	for _, v := range []string{candidate.TerminalID, candidate.Environment, candidate.Host, candidate.SSHUser, candidate.Socket, candidate.CanonicalName} {
		if strings.TrimSpace(v) == "" || strings.ContainsRune(v, '\x00') {
			return nil, false, errors.New("invalid terminal identity field")
		}
	}
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return nil, false, err
	}
	entropy[6] = (entropy[6] & 0x0f) | 0x40
	entropy[8] = (entropy[8] & 0x3f) | 0x80
	incarnation := fmt.Sprintf("%x-%x-%x-%x-%x", entropy[0:4], entropy[4:6], entropy[6:8], entropy[8:10], entropy[10:16])
	result, err := s.DB.Exec(`INSERT INTO terminal_instances(user_id,connection_id,terminal_id,environment,host,port,ssh_user,socket,canonical_name,incarnation,state)
 VALUES(?,?,?,?,?,?,?,?,?,?,'reserved') ON CONFLICT(user_id,connection_id,terminal_id) DO NOTHING`, candidate.UserID, candidate.ConnectionID, candidate.TerminalID, candidate.Environment, candidate.Host, candidate.Port, candidate.SSHUser, candidate.Socket, candidate.CanonicalName, incarnation)
	if err != nil {
		return nil, false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, false, err
	}
	row, err := s.GetTerminalInstance(candidate.UserID, candidate.ConnectionID, candidate.TerminalID)
	if err != nil {
		return nil, false, err
	}
	if row.Environment != candidate.Environment || row.Host != candidate.Host || row.Port != candidate.Port || row.SSHUser != candidate.SSHUser || row.Socket != candidate.Socket || row.CanonicalName != candidate.CanonicalName {
		return row, false, ErrTerminalIdentityMismatch
	}
	return row, affected == 1 && row.Incarnation == incarnation && row.State == TerminalReserved, nil
}

// CompareAndSwapTerminalInstanceState requires both incarnation and prior state.
// A successful activation must be preceded by external identity verification;
// this SQL operation does not itself probe or create remote sessions. Closed
// identities are permanent tombstones. Missing may return to active only for
// the same incarnation (for example after explicit verified attach).
func (s *Store) CompareAndSwapTerminalInstanceState(userID, connectionID int64, terminalID, incarnation string, from, to TerminalInstanceState) (bool, error) {
	valid := (from == TerminalReserved && (to == TerminalActive || to == TerminalMissing || to == TerminalClosed)) || (from == TerminalActive && (to == TerminalMissing || to == TerminalClosed)) || (from == TerminalMissing && (to == TerminalActive || to == TerminalClosed))
	if !valid || incarnation == "" {
		return false, errors.New("invalid terminal state transition")
	}
	result, err := s.DB.Exec(`UPDATE terminal_instances SET state=?,updated_at=CURRENT_TIMESTAMP,
 activated_at=CASE WHEN ?='active' THEN COALESCE(activated_at,CURRENT_TIMESTAMP) ELSE activated_at END,
 missing_at=CASE WHEN ?='missing' THEN CURRENT_TIMESTAMP ELSE missing_at END,
 closed_at=CASE WHEN ?='closed' THEN CURRENT_TIMESTAMP ELSE closed_at END
 WHERE user_id=? AND connection_id=? AND terminal_id=? AND incarnation=? AND state=?`, to, to, to, to, userID, connectionID, terminalID, incarnation, from)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}
