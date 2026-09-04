package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xufanchn/webterm/auth"
	wtcrypto "github.com/xufanchn/webterm/crypto"
	"github.com/xufanchn/webterm/store"
)

func TestCreateConnectionUsesDefaultSessionLimitWhenClientOmitsIt(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("connection-owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := wtcrypto.New("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	h := &ConnectionHandler{Store: st, AESCipher: cipher}
	req := httptest.NewRequest(http.MethodPost, "/api/connections", bytes.NewBufferString(`{"name":"new host","host":"192.168.11.87","port":22,"username":"pgz","auth_method":"password","password":"test-password"}`))
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Create)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("create status = %d, body = %s", res.Code, res.Body.String())
	}
	connections, err := st.ListConnections(0, userID)
	if err != nil || len(connections) != 1 {
		t.Fatalf("created connections = %#v, err = %v", connections, err)
	}
	if connections[0].MaxSessions != 30 {
		t.Fatalf("MaxSessions = %d, want default 30 so a newly created host can open SSH terminals", connections[0].MaxSessions)
	}
}

func TestUpdateConnectionKeepsItsSessionLimitWhenTheClientDoesNotChangeIt(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("connection-editor", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	connectionID, err := st.CreateConnection(&store.Connection{Name: "before", Host: "192.168.11.87", Port: 22, Username: "pgz", AuthMethod: "password", CreatedBy: userID, MaxSessions: 10})
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := wtcrypto.New("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	h := &ConnectionHandler{Store: st, AESCipher: cipher}
	req := httptest.NewRequest(http.MethodPut, "/api/connections/1", bytes.NewBufferString(`{"name":"after"}`))
	req.SetPathValue("id", "1")
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Update)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", res.Code, res.Body.String())
	}
	connection, err := st.GetConnection(connectionID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.MaxSessions != 10 {
		t.Fatalf("MaxSessions = %d, want existing 10", connection.MaxSessions)
	}
}
