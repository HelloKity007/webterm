package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

func issueTicketRequest(t *testing.T, handler http.Handler, userID int64, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/ws-tickets", bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func TestWSTicketIsScopedSingleUseAndExpires(t *testing.T) {
	service := NewWSTicketService()
	now := time.Unix(100, 0)
	service.now = func() time.Time { return now }
	issued, err := service.issue(wsTicket{claims: auth.Claims{UserID: 7}, endpoint: "ssh", connID: 3, terminalID: "term-a"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.consume(issued, "ssh", 4, "term-a", ""); !errors.Is(err, errInvalidWSTicket) {
		t.Fatalf("wrong resource consume error = %v", err)
	}
	if _, err := service.consume(issued, "ssh", 3, "term-a", ""); !errors.Is(err, errInvalidWSTicket) {
		t.Fatalf("scope mismatch must burn the ticket, got %v", err)
	}
	expiring, _ := service.issue(wsTicket{claims: auth.Claims{UserID: 7}, endpoint: "layout", clientID: "browser-a"})
	now = now.Add(wsTicketTTL + time.Second)
	if _, err := service.consume(expiring, "layout", 0, "", "browser-a"); !errors.Is(err, errInvalidWSTicket) {
		t.Fatalf("expired consume error = %v", err)
	}
}

func TestWSTicketIssueAuthorizesConnectionAndDoesNotCache(t *testing.T) {
	st := newQuickConnectTestStore(t)
	owner, _ := st.CreateUser("ticket-owner", "hash", "user")
	other, _ := st.CreateUser("ticket-other", "hash", "user")
	connectionID, _ := st.CreateConnection(&store.Connection{Name: "private", Host: "127.0.0.1", Port: 22,
		Username: "tester", AuthMethod: "password", CreatedBy: owner, MaxSessions: 30})
	service := NewWSTicketService()
	endpoint := auth.Middleware(http.HandlerFunc((&WSTicketHandler{Store: st, Tickets: service}).Issue))
	body := `{"endpoint":"ssh","conn_id":` + strconv.FormatInt(connectionID, 10) + `,"terminal_id":"term-a"}`
	denied := issueTicketRequest(t, endpoint, other, body)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("denied code = %d, body=%s", denied.Code, denied.Body.String())
	}
	allowed := issueTicketRequest(t, endpoint, owner, body)
	if allowed.Code != http.StatusOK || allowed.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("allowed code=%d cache=%q body=%s", allowed.Code, allowed.Header().Get("Cache-Control"), allowed.Body.String())
	}
	var response struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(allowed.Body.Bytes(), &response); err != nil || response.Ticket == "" {
		t.Fatalf("ticket response: %v %q", err, allowed.Body.String())
	}
}

func TestTicketWebSocketHandlerRejectsBeforeUpgradeAndInjectsClaims(t *testing.T) {
	service := NewWSTicketService()
	token, _ := service.issue(wsTicket{claims: auth.Claims{UserID: 19}, endpoint: "ssh", connID: 4, terminalID: "term-a"})
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if user := auth.GetUser(r); user == nil || user.UserID != 19 {
			t.Fatal("ticket claims missing")
		}
		if r.URL.Query().Get("ticket") != "" {
			t.Fatal("ticket leaked to downstream handler")
		}
		w.WriteHeader(http.StatusNoContent)
	})
	handler := TicketWebSocketHandler{Tickets: service, Endpoint: "ssh", Next: next}

	badOrigin := httptest.NewRequest(http.MethodGet, "https://webterm.test/ws/ssh/4?ticket="+token+"&terminal_id=term-a", nil)
	badOrigin.SetPathValue("conn_id", "4")
	badOrigin.Header.Set("Origin", "https://evil.test")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, badOrigin)
	if recorder.Code != http.StatusForbidden || called {
		t.Fatalf("bad origin code=%d called=%v", recorder.Code, called)
	}

	badScheme := httptest.NewRequest(http.MethodGet, "https://webterm.test/ws/ssh/4?ticket="+token+"&terminal_id=term-a", nil)
	badScheme.Host = "webterm.test"
	badScheme.SetPathValue("conn_id", "4")
	badScheme.Header.Set("Origin", "http://webterm.test")
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, badScheme)
	if recorder.Code != http.StatusForbidden || called {
		t.Fatalf("bad scheme code=%d called=%v", recorder.Code, called)
	}

	good := httptest.NewRequest(http.MethodGet, "https://webterm.test/ws/ssh/4?ticket="+token+"&terminal_id=term-a", nil)
	good.Host = "webterm.test"
	good.SetPathValue("conn_id", "4")
	good.Header.Set("Origin", "https://webterm.test")
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, good)
	if recorder.Code != http.StatusNoContent || !called {
		t.Fatalf("good code=%d called=%v body=%s", recorder.Code, called, recorder.Body.String())
	}

	replay := httptest.NewRequest(http.MethodGet, "https://webterm.test/ws/ssh/4?ticket="+token+"&terminal_id=term-a", nil)
	replay.Host = "webterm.test"
	replay.SetPathValue("conn_id", "4")
	replay.Header.Set("Origin", "https://webterm.test")
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, replay)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("replay code=%d", recorder.Code)
	}
}

func TestTicketWebSocketHandlerRechecksDeletedResourceBeforeUpgrade(t *testing.T) {
	st := newQuickConnectTestStore(t)
	owner, _ := st.CreateUser("ticket-revoked-owner", "hash", "user")
	connectionID, _ := st.CreateConnection(&store.Connection{Name: "private", Host: "127.0.0.1", Port: 22,
		Username: "tester", AuthMethod: "password", CreatedBy: owner, MaxSessions: 30})
	service := NewWSTicketService()
	token, _ := service.issue(wsTicket{claims: auth.Claims{UserID: owner}, endpoint: "ssh", connID: connectionID, terminalID: "term-a"})
	if err := st.DeleteConnection(connectionID); err != nil {
		t.Fatal(err)
	}
	called := false
	handler := TicketWebSocketHandler{Store: st, Tickets: service, Endpoint: "ssh", Next: http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })}
	request := httptest.NewRequest(http.MethodGet, "https://webterm.test/ws/ssh/1?ticket="+token+"&terminal_id=term-a", nil)
	request.Host = "webterm.test"
	request.SetPathValue("conn_id", strconv.FormatInt(connectionID, 10))
	request.Header.Set("Origin", "https://webterm.test")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || called {
		t.Fatalf("deleted resource handshake code=%d called=%v", response.Code, called)
	}
}
