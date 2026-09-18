package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

const terminalCreateError = "terminal creation failed; no replacement session was attached"

// terminalRegistrySocket is an identity label, not an instruction to pass
// "-L default" to tmux. The empty/default server must still be recorded
// explicitly so a release-test registry cannot be confused with production.
func (h *WSHandler) terminalRegistrySocket() string {
	if strings.TrimSpace(h.TmuxSocket) == "" {
		return "default"
	}
	return h.TmuxSocket
}

func (h *WSHandler) terminalEnvironment() string {
	if strings.TrimSpace(h.Environment) == "" {
		return "production"
	}
	return h.Environment
}

func newServerTerminalID() (string, error) {
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", err
	}
	return "terminal-" + hex.EncodeToString(entropy[:]), nil
}

func terminalCreateCommand(sessionName, incarnation string) (string, error) {
	if !identitySessionPattern.MatchString(sessionName) || !identityIncarnationPattern.MatchString(incarnation) {
		return "", errors.New("invalid terminal creation identity")
	}
	// A new-session collision makes the shell command stop before set-option;
	// in particular it must never stamp an incumbent session with a new UUID.
	// This is the sole intentional server/session creation path.
	return fmt.Sprintf("tmux new-session -d -s %s && tmux set-option -t =%s: @webterm_incarnation %s && tmux display-message -p -t =%s: WEBTERM_CREATED:%s", sessionName, sessionName, incarnation, sessionName, incarnation), nil
}

func terminalVerifyCreatedCommand(sessionName, incarnation string) (string, error) {
	if !identitySessionPattern.MatchString(sessionName) || !identityIncarnationPattern.MatchString(incarnation) {
		return "", errors.New("invalid terminal verification identity")
	}
	// -N makes uncertain acknowledgement recovery observational: it can verify
	// the precise marker but cannot recreate a lost tmux server or session.
	return fmt.Sprintf("tmux -N has-session -t =%s && test \"$(tmux -N display-message -p -t =%s: '#{@webterm_incarnation}')\" = %s", sessionName, sessionName, incarnation), nil
}

func terminalAdoptCommand(sessionName, incarnation string) (string, error) {
	if !identitySessionPattern.MatchString(sessionName) || !identityIncarnationPattern.MatchString(incarnation) {
		return "", errors.New("invalid terminal adoption identity")
	}
	// The target/name and marker-empty check execute inside one tmux command
	// queue. A stale layout therefore cannot stamp a same-name replacement that
	// appears between a shell-side probe and set-option. The final verification
	// is noncreating and makes any post-command replacement fail closed.
	condition := fmt.Sprintf("#{&&:#{==:#{session_name},%s},#{==:#{@webterm_incarnation},}}", sessionName)
	return fmt.Sprintf("tmux -N has-session -t =%s && tmux -N if-shell -F -t =%s: '%s' 'set-option -t =%s: @webterm_incarnation %s' '' && test \"$(tmux -N display-message -p -t =%s: '#{@webterm_incarnation}')\" = %s", sessionName, sessionName, condition, sessionName, incarnation, sessionName, incarnation), nil
}

func (h *WSHandler) verifiedTerminalInstance(userID, connectionID int64, terminalID string, connection *store.Connection) (*store.TerminalInstance, error) {
	if strings.TrimSpace(terminalID) == "" {
		return nil, errors.New("terminal_id is required")
	}
	instance, err := h.Store.GetTerminalInstance(userID, connectionID, terminalID)
	if err != nil {
		return nil, err
	}
	if instance.State != store.TerminalActive {
		return nil, fmt.Errorf("terminal instance is %s", instance.State)
	}
	if !h.terminalInstanceMatchesEndpoint(instance, connection) {
		return nil, store.ErrTerminalIdentityMismatch
	}
	return instance, nil
}

// terminalInstanceMatchesEndpoint verifies immutable attachment authority. A
// closed record may be acknowledged as already closed by the close endpoint,
// but it is never attachable or eligible for a new-session fallback.
func (h *WSHandler) terminalInstanceMatchesEndpoint(instance *store.TerminalInstance, connection *store.Connection) bool {
	return instance != nil && connection != nil &&
		instance.Environment == h.terminalEnvironment() && instance.Host == connection.Host &&
		instance.Port == connection.Port && instance.SSHUser == connection.Username &&
		instance.Socket == h.terminalRegistrySocket() &&
		identitySessionPattern.MatchString(instance.CanonicalName) &&
		identityIncarnationPattern.MatchString(instance.Incarnation)
}

// CreateTerminalSession is the only normal creation authority. The browser
// does not choose a terminal ID or canonical tmux name. A later WebSocket
// attach has no create branch and can only attach to this reserved identity.
func (h *WSHandler) CreateTerminalSession(w http.ResponseWriter, r *http.Request) {
	connID, err := strconv.ParseInt(r.PathValue("conn_id"), 10, 64)
	if err != nil || connID < 1 {
		http.Error(w, `{"error":"invalid connection"}`, http.StatusBadRequest)
		return
	}
	user := auth.GetUser(r)
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	connection, err := h.Store.GetConnection(connID)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if !canUseConnection(user, connection) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	terminalID, err := newServerTerminalID()
	if err != nil {
		http.Error(w, `{"error":"failed to allocate terminal identity"}`, http.StatusInternalServerError)
		return
	}
	canonicalName, err := persistentTerminalSessionName(user.UserID, connID, terminalID)
	if err != nil {
		http.Error(w, `{"error":"failed to allocate terminal identity"}`, http.StatusInternalServerError)
		return
	}
	instance, won, err := h.Store.ReserveTerminalInstance(store.TerminalInstance{
		UserID: user.UserID, ConnectionID: connID, TerminalID: terminalID,
		Environment: h.terminalEnvironment(), Host: connection.Host, Port: connection.Port,
		SSHUser: connection.Username, Socket: h.terminalRegistrySocket(), CanonicalName: canonicalName,
	})
	if err != nil || !won {
		// ID collision is deliberately not retried inside this request: a caller
		// must never receive an identity whose creation authority is ambiguous.
		http.Error(w, `{"error":"failed to reserve terminal identity"}`, http.StatusInternalServerError)
		return
	}
	command, err := terminalCreateCommand(instance.CanonicalName, instance.Incarnation)
	if err != nil {
		http.Error(w, `{"error":"failed to allocate terminal identity"}`, http.StatusInternalServerError)
		return
	}
	if err := h.runTerminalCommand(connection, scopeTmuxCommand(command, h.TmuxSocket, h.TmuxBinary)); err != nil {
		// Keep the reservation. A transport acknowledgement can be lost after
		// tmux has created the session; silently retrying would be unsafe.
		http.Error(w, `{"error":"`+terminalCreateError+`","code":"TERMINAL_CREATE_UNCERTAIN"}`, http.StatusBadGateway)
		return
	}
	activated, err := h.Store.CompareAndSwapTerminalInstanceState(user.UserID, connID, terminalID, instance.Incarnation, store.TerminalReserved, store.TerminalActive)
	if err != nil || !activated {
		http.Error(w, `{"error":"`+terminalCreateError+`","code":"TERMINAL_CREATE_UNCERTAIN"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"terminal_id": terminalID})
}

// AdoptTerminalSession is an explicit migration path for a pre-registry
// layout entry. It can label and attach only an already-existing exact tmux
// session; it contains no new-session/start-server branch and never treats a
// missing legacy pane as permission to create a replacement shell.
func (h *WSHandler) AdoptTerminalSession(w http.ResponseWriter, r *http.Request) {
	connID, err := strconv.ParseInt(r.PathValue("conn_id"), 10, 64)
	if err != nil || connID < 1 {
		http.Error(w, `{"error":"invalid connection"}`, http.StatusBadRequest)
		return
	}
	user := auth.GetUser(r)
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	connection, err := h.Store.GetConnection(connID)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if !canUseConnection(user, connection) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
	var request struct {
		TerminalID     string `json:"terminal_id"`
		WorkspaceIndex int64  `json:"workspace_index"`
		PanelNumber    int64  `json:"panel_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || strings.TrimSpace(request.TerminalID) == "" || request.WorkspaceIndex < 1 || request.PanelNumber < 1 {
		http.Error(w, `{"error":"invalid terminal adoption request"}`, http.StatusBadRequest)
		return
	}
	canonicalName, err := persistentTerminalPanelSessionName(user.UserID, request.WorkspaceIndex, request.PanelNumber, request.TerminalID)
	if err != nil {
		http.Error(w, `{"error":"invalid terminal adoption request"}`, http.StatusBadRequest)
		return
	}
	instance, won, err := h.Store.ReserveTerminalInstance(store.TerminalInstance{
		UserID: user.UserID, ConnectionID: connID, TerminalID: request.TerminalID,
		Environment: h.terminalEnvironment(), Host: connection.Host, Port: connection.Port,
		SSHUser: connection.Username, Socket: h.terminalRegistrySocket(), CanonicalName: canonicalName,
	})
	if errors.Is(err, store.ErrTerminalIdentityMismatch) {
		http.Error(w, `{"error":"existing terminal identity belongs to another endpoint or panel","code":"TERMINAL_IDENTITY_MISMATCH"}`, http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"failed to reserve terminal identity"}`, http.StatusInternalServerError)
		return
	}
	if instance.State == store.TerminalActive {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"terminal_id": instance.TerminalID, "status": "active"})
		return
	}
	var command string
	if won {
		command, err = terminalAdoptCommand(instance.CanonicalName, instance.Incarnation)
	} else {
		command, err = terminalVerifyCreatedCommand(instance.CanonicalName, instance.Incarnation)
	}
	if err != nil || h.runTerminalCommand(connection, scopeTmuxCommand(command, h.TmuxSocket, h.TmuxBinary)) != nil {
		http.Error(w, `{"error":"existing terminal could not be verified; no replacement session was created","code":"TERMINAL_ADOPTION_UNCERTAIN"}`, http.StatusConflict)
		return
	}
	if instance.State == store.TerminalReserved {
		if active, transitionErr := h.Store.CompareAndSwapTerminalInstanceState(user.UserID, connID, request.TerminalID, instance.Incarnation, store.TerminalReserved, store.TerminalActive); transitionErr != nil || !active {
			http.Error(w, `{"error":"existing terminal was verified but lifecycle state could not be recorded","code":"TERMINAL_ADOPTION_UNCERTAIN"}`, http.StatusInternalServerError)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"terminal_id": instance.TerminalID, "status": "active"})
}
