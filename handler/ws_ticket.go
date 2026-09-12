package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

const wsTicketTTL = 30 * time.Second

type wsTicket struct {
	claims     auth.Claims
	endpoint   string
	connID     int64
	terminalID string
	clientID   string
	expiresAt  time.Time
}

type WSTicketService struct {
	mu      sync.Mutex
	tickets map[string]wsTicket
	now     func() time.Time
}

func NewWSTicketService() *WSTicketService {
	return &WSTicketService{tickets: make(map[string]wsTicket), now: time.Now}
}

func (s *WSTicketService) issue(ticket wsTicket) (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for key, candidate := range s.tickets {
		if !candidate.expiresAt.After(now) {
			delete(s.tickets, key)
		}
	}
	ticket.expiresAt = now.Add(wsTicketTTL)
	s.tickets[token] = ticket
	return token, nil
}

var errInvalidWSTicket = errors.New("invalid websocket ticket")

func (s *WSTicketService) consume(token, endpoint string, connID int64, terminalID, clientID string) (*auth.Claims, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ticket, ok := s.tickets[token]
	if ok {
		delete(s.tickets, token) // every attempted use is single-use
	}
	if !ok || !ticket.expiresAt.After(s.now()) || ticket.endpoint != endpoint || ticket.connID != connID ||
		ticket.terminalID != terminalID || ticket.clientID != clientID {
		return nil, errInvalidWSTicket
	}
	claims := ticket.claims
	return &claims, nil
}

type WSTicketHandler struct {
	Store   *store.Store
	Tickets *WSTicketService
}

type wsTicketRequest struct {
	Endpoint   string `json:"endpoint"`
	ConnID     int64  `json:"conn_id"`
	TerminalID string `json:"terminal_id"`
	ClientID   string `json:"client_id"`
}

func (h *WSTicketHandler) Issue(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r)
	if user == nil || h.Tickets == nil || h.Store == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	storedUser, err := h.Store.GetUser(user.UserID)
	if err != nil || storedUser.Disabled {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	user.Username = storedUser.Username
	user.Role = storedUser.Role
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var request wsTicketRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || !validWSTicketRequest(request) {
		http.Error(w, `{"error":"invalid websocket scope"}`, http.StatusBadRequest)
		return
	}
	switch request.Endpoint {
	case "ssh", "sftp":
		connection, err := h.Store.GetConnection(request.ConnID)
		if err != nil {
			http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
			return
		}
		if !canUseConnection(user, connection) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
	case "db":
		connection, err := h.Store.GetDbConnection(request.ConnID)
		if err != nil {
			http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
			return
		}
		if !canUseDbConnection(user, connection) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
	}
	token, err := h.Tickets.issue(wsTicket{claims: *user, endpoint: request.Endpoint, connID: request.ConnID,
		terminalID: request.TerminalID, clientID: request.ClientID})
	if err != nil {
		http.Error(w, `{"error":"ticket generation failed"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"ticket": token, "expires_in": int(wsTicketTTL.Seconds())})
}

func validWSTicketRequest(request wsTicketRequest) bool {
	switch request.Endpoint {
	case "ssh":
		return request.ConnID > 0 && request.TerminalID != "" && len(request.TerminalID) <= 128 && request.ClientID == ""
	case "sftp", "db":
		return request.ConnID > 0 && request.TerminalID == "" && request.ClientID == ""
	case "layout":
		return request.ConnID == 0 && request.TerminalID == "" && request.ClientID != "" && len(request.ClientID) <= 128
	case "local-fs":
		return request.ConnID == 0 && request.TerminalID == "" && request.ClientID == ""
	default:
		return false
	}
}

type TicketWebSocketHandler struct {
	Store    *store.Store
	Tickets  *WSTicketService
	Endpoint string
	Next     http.Handler
}

func (h TicketWebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Tickets == nil || h.Next == nil {
		http.Error(w, `{"error":"websocket unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if !sameWebSocketOrigin(r) {
		http.Error(w, `{"error":"forbidden origin"}`, http.StatusForbidden)
		return
	}
	connID, _ := strconv.ParseInt(r.PathValue("conn_id"), 10, 64)
	terminalID, clientID := "", ""
	if h.Endpoint == "ssh" {
		terminalID = r.URL.Query().Get("terminal_id")
	}
	if h.Endpoint == "layout" {
		clientID = r.URL.Query().Get("client_id")
	}
	claims, err := h.Tickets.consume(r.URL.Query().Get("ticket"), h.Endpoint, connID, terminalID, clientID)
	if err != nil {
		http.Error(w, `{"error":"invalid websocket ticket"}`, http.StatusUnauthorized)
		return
	}
	if h.Store != nil {
		storedUser, userErr := h.Store.GetUser(claims.UserID)
		if userErr != nil || storedUser.Disabled {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		claims.Username = storedUser.Username
		claims.Role = storedUser.Role
		switch h.Endpoint {
		case "ssh", "sftp":
			connection, connectionErr := h.Store.GetConnection(connID)
			if connectionErr != nil {
				http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
				return
			}
			if !canUseConnection(claims, connection) {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
		case "db":
			connection, connectionErr := h.Store.GetDbConnection(connID)
			if connectionErr != nil {
				http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
				return
			}
			if !canUseDbConnection(claims, connection) {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
		}
	}
	query := r.URL.Query()
	query.Del("ticket")
	r.URL.RawQuery = query.Encode()
	h.Next.ServeHTTP(w, auth.WithUser(r, claims))
}

func sameWebSocketOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return false
	}
	expectedScheme := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")))
	if expectedScheme == "" {
		expectedScheme = strings.ToLower(r.URL.Scheme)
	}
	if expectedScheme == "" {
		if r.TLS != nil {
			expectedScheme = "https"
		} else {
			expectedScheme = "http"
		}
	}
	return parsed.Scheme == expectedScheme && strings.EqualFold(parsed.Host, r.Host)
}
