package handler

import (
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

type AuthHandler struct {
	Store         *store.Store
	Environment   string
	TestAutoLogin bool
}

// TestSession is a temporary, explicitly enabled release-test convenience.
// Production refuses it even if the flag was accidentally supplied.
func (h *AuthHandler) TestSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if h.Environment != "release-test" || !h.TestAutoLogin {
		http.NotFound(w, r)
		return
	}
	user, err := h.Store.GetUserByUsername("admin")
	if err != nil || user.Disabled || user.Role != "admin" {
		http.Error(w, "test account unavailable", http.StatusForbidden)
		return
	}
	token, err := auth.GenerateToken(user.ID, user.Username, user.Role)
	if err != nil {
		http.Error(w, "session unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user":  map[string]interface{}{"id": user.ID, "username": user.Username, "role": user.Role},
	})
}

const (
	maxLoginFailures = 10
	loginWindow      = 15 * time.Minute
)

var (
	loginMu     sync.Mutex
	loginFailed = map[string]*loginFailEntry{}
)

type loginFailEntry struct {
	count int
	until time.Time
}

func loginAllowed(ip string) bool {
	loginMu.Lock()
	defer loginMu.Unlock()
	e := loginFailed[ip]
	if e == nil {
		return true
	}
	if time.Now().After(e.until) {
		delete(loginFailed, ip)
		return true
	}
	return e.count < maxLoginFailures
}

func recordLoginFailure(ip string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	e := loginFailed[ip]
	if e == nil || time.Now().After(e.until) {
		loginFailed[ip] = &loginFailEntry{count: 1, until: time.Now().Add(loginWindow)}
		return
	}
	e.count++
}

func recordLoginSuccess(ip string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	delete(loginFailed, ip)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !loginAllowed(ip) {
		http.Error(w, `{"error":"too many attempts, please try again later"}`, http.StatusTooManyRequests)
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	user, err := h.Store.GetUserByUsername(req.Username)
	if err != nil {
		recordLoginFailure(ip)
		http.Error(w, `{"error":"invalid credentials"}`, http.StatusUnauthorized)
		return
	}
	if user.Disabled {
		recordLoginFailure(ip)
		http.Error(w, `{"error":"account disabled"}`, http.StatusForbidden)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		recordLoginFailure(ip)
		http.Error(w, `{"error":"invalid credentials"}`, http.StatusUnauthorized)
		return
	}
	token, err := auth.GenerateToken(user.ID, user.Username, user.Role)
	if err != nil {
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	recordLoginSuccess(ip)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user":  map[string]interface{}{"id": user.ID, "username": user.Username, "role": user.Role},
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte(`{"status":"ok"}`))
}
