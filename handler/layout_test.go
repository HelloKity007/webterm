package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/store"
)

func layoutRequest(t *testing.T, method, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, "/api/layout", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	return res
}

func TestLayoutRejectsConnectionTheUserCannotUse(t *testing.T) {
	st := newQuickConnectTestStore(t)
	ownerID, err := st.CreateUser("owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	viewerID, err := st.CreateUser("viewer", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	connectionID, err := st.CreateConnection(&store.Connection{
		Name: "owner only", Host: "10.0.0.8", Port: 22, Username: "owner", AuthMethod: "password", CreatedBy: ownerID,
	})
	if err != nil {
		t.Fatal(err)
	}

	h := &LayoutHandler{Store: st}
	body, err := json.Marshal(map[string]any{
		"schema_version": 1,
		"revision":       0,
		"layout": map[string]any{
			"tree": map[string]any{"type": "leaf", "id": "root"},
			"panes": map[string]any{
				"root": map[string]any{"tabs": []map[string]any{{"id": "ssh-1", "type": "ssh", "title": "owner only", "connId": connectionID}}},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testJWT(t, viewerID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Save)).ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s; want %d", res.Code, res.Body.String(), http.StatusForbidden)
	}
}

func TestLayoutReturnsConflictForStaleRevision(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("alice", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	h := &LayoutHandler{Store: st}
	token := testJWT(t, userID, "user")
	body := []byte(`{"schema_version":1,"revision":0,"layout":{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[],"activeTabId":null}},"focusedPaneId":"root"}}`)
	for attempt := 0; attempt < 2; attempt++ {
		req := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		res := httptest.NewRecorder()
		auth.Middleware(http.HandlerFunc(h.Save)).ServeHTTP(res, req)
		if attempt == 0 && res.Code != http.StatusOK {
			t.Fatalf("first save status = %d, body = %s", res.Code, res.Body.String())
		}
		if attempt == 1 && res.Code != http.StatusConflict {
			t.Fatalf("stale save status = %d, body = %s; want %d", res.Code, res.Body.String(), http.StatusConflict)
		}
	}
}

func TestLayoutSavePublishesNewRevisionToSavingUser(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("layout-owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	hub := NewLayoutHub()
	events, unsubscribe := hub.Subscribe(userID)
	defer unsubscribe()
	h := &LayoutHandler{Store: st, Hub: hub}
	req := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader([]byte(`{"schema_version":1,"revision":0,"layout":{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[],"activeTabId":null}},"focusedPaneId":"root"}}`)))
	req.Header.Set("Authorization", "Bearer "+testJWT(t, userID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Save)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", res.Code, res.Body.String())
	}
	select {
	case revision := <-events:
		if revision != 1 {
			t.Fatalf("published revision = %d, want 1", revision)
		}
	default:
		t.Fatal("successful layout save did not publish a revision")
	}
}

func TestLayoutGetSkipsTabsForUnavailableConnections(t *testing.T) {
	st := newQuickConnectTestStore(t)
	ownerID, err := st.CreateUser("owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	viewerID, err := st.CreateUser("viewer", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	connectionID, err := st.CreateConnection(&store.Connection{Name: "private", Host: "10.0.0.9", Port: 22, Username: "owner", AuthMethod: "password", CreatedBy: ownerID})
	if err != nil {
		t.Fatal(err)
	}
	stored := []byte(fmt.Sprintf(`{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[{"id":"ssh-private","type":"ssh","title":"private","connId":%d}],"activeTabId":"ssh-private"}},"focusedPaneId":"root"}`, connectionID))
	if _, err := st.SaveUserLayout(viewerID, 1, 0, stored); err != nil {
		t.Fatal(err)
	}
	h := &LayoutHandler{Store: st}
	req := httptest.NewRequest(http.MethodGet, "/api/layout", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, viewerID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Get)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	var response struct {
		SkippedTabs int `json:"skipped_tabs"`
		Layout      struct {
			Panes map[string]struct {
				Tabs []json.RawMessage `json:"tabs"`
			} `json:"panes"`
		} `json:"layout"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.SkippedTabs != 1 || len(response.Layout.Panes["root"].Tabs) != 0 {
		t.Fatalf("filtered response = %#v, want one skipped tab and no restored tab", response)
	}
}

func TestLayoutIsSavedPerUserAndReturnsRevision(t *testing.T) {
	st := newQuickConnectTestStore(t)
	aliceID, err := st.CreateUser("alice", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	bobID, err := st.CreateUser("bob", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	h := &LayoutHandler{Store: st}

	aliceToken := testJWT(t, aliceID, "user")
	saveReq := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader([]byte(`{"schema_version":1,"revision":0,"layout":{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[],"activeTabId":null}},"focusedPaneId":"root"}}`)))
	saveReq.Header.Set("Authorization", "Bearer "+aliceToken)
	saveRes := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Save)).ServeHTTP(saveRes, saveReq)
	if saveRes.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", saveRes.Code, saveRes.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/layout", nil)
	getReq.Header.Set("Authorization", "Bearer "+aliceToken)
	getRes := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Get)).ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", getRes.Code, getRes.Body.String())
	}
	var aliceLayout struct {
		Revision int64           `json:"revision"`
		Layout   json.RawMessage `json:"layout"`
	}
	if err := json.NewDecoder(getRes.Body).Decode(&aliceLayout); err != nil {
		t.Fatal(err)
	}
	if aliceLayout.Revision != 1 || !bytes.Contains(aliceLayout.Layout, []byte(`"root"`)) {
		t.Fatalf("alice layout = %#v, want saved layout at revision 1", aliceLayout)
	}

	bobToken := testJWT(t, bobID, "user")
	bobReq := httptest.NewRequest(http.MethodGet, "/api/layout", nil)
	bobReq.Header.Set("Authorization", "Bearer "+bobToken)
	bobRes := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Get)).ServeHTTP(bobRes, bobReq)
	if bobRes.Code != http.StatusOK {
		t.Fatalf("bob get status = %d, body = %s", bobRes.Code, bobRes.Body.String())
	}
	var bobLayout struct {
		Revision int64 `json:"revision"`
	}
	if err := json.NewDecoder(bobRes.Body).Decode(&bobLayout); err != nil {
		t.Fatal(err)
	}
	if bobLayout.Revision != 0 {
		t.Fatalf("bob revision = %d, want isolated empty layout", bobLayout.Revision)
	}
}
