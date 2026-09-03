package handler

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/xufanchn/webterm/auth"
	wtcrypto "github.com/xufanchn/webterm/crypto"
	"github.com/xufanchn/webterm/store"
)

func newQuickConnectTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(filepath.Join(t.TempDir(), "webterm.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func testJWT(t *testing.T, userID int64, role string) string {
	t.Helper()
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	auth.SetJWTSecret(secret)
	token, err := auth.GenerateToken(userID, role, role)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestQuickConnectReturnsManagedConnectionToAdminOnly(t *testing.T) {
	st := newQuickConnectTestStore(t)
	adminID, err := st.CreateUser("admin", "hash", "admin")
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := wtcrypto.New("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := EnsureManagedLocalConnection(st, cipher, LocalQuickConnectSettings{
		Host: "127.0.0.1", Port: 22, Username: "pgz",
	}, "test-only-password"); err != nil {
		t.Fatal(err)
	}

	h := &QuickConnectHandler{Store: st}
	adminRequest := httptest.NewRequest(http.MethodPost, "/api/quick-connect/local", bytes.NewReader(nil))
	adminRequest.Header.Set("Authorization", "Bearer "+testJWT(t, adminID, "admin"))
	adminResponse := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.OpenLocal)).ServeHTTP(adminResponse, adminRequest)
	if adminResponse.Code != http.StatusOK {
		t.Fatalf("admin status = %d, body = %s", adminResponse.Code, adminResponse.Body.String())
	}
	var response struct {
		Connection struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"connection"`
	}
	if err := json.NewDecoder(adminResponse.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Connection.ID == 0 || response.Connection.Name == "" {
		t.Fatalf("admin response = %#v, want managed connection identity", response)
	}

	userRequest := httptest.NewRequest(http.MethodPost, "/api/quick-connect/local", nil)
	userRequest.Header.Set("Authorization", "Bearer "+testJWT(t, 999, "user"))
	userResponse := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.OpenLocal)).ServeHTTP(userResponse, userRequest)
	if userResponse.Code != http.StatusForbidden {
		t.Fatalf("user status = %d, want %d", userResponse.Code, http.StatusForbidden)
	}
}
