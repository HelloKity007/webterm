package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xufanchn/webterm/auth"
)

func TestTestSessionRequiresReleaseEnvironmentAndExplicitFlag(t *testing.T) {
	for _, env := range []string{"production", "", "release-test"} {
		for _, enabled := range []bool{false, true} {
			if env == "release-test" && enabled {
				continue
			}
			h := &AuthHandler{Environment: env, TestAutoLogin: enabled}
			res := httptest.NewRecorder()
			h.TestSession(res, httptest.NewRequest(http.MethodPost, "/api/auth/test-session", nil))
			if res.Code != http.StatusNotFound {
				t.Fatalf("env=%q enabled=%t status=%d", env, enabled, res.Code)
			}
		}
	}
}

func TestTestSessionCreatesUsableAdminSession(t *testing.T) {
	st := newQuickConnectTestStore(t)
	if _, err := st.CreateUser("admin", "unused-password", "admin"); err != nil {
		t.Fatal(err)
	}
	auth.SetJWTSecret([]byte("test-session-only-secret"))
	h := &AuthHandler{Store: st, Environment: "release-test", TestAutoLogin: true}
	res := httptest.NewRecorder()
	h.TestSession(res, httptest.NewRequest(http.MethodPost, "/api/auth/test-session", nil))
	if res.Code != http.StatusOK {
		t.Fatal(res.Code, res.Body.String())
	}
	var session struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+session.Token)
	checked := httptest.NewRecorder()
	auth.Middleware(auth.AdminOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))).ServeHTTP(checked, req)
	if checked.Code != http.StatusNoContent {
		t.Fatal("auto-login token rejected", checked.Code)
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("session must not be cached")
	}
}
