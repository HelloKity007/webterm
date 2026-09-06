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

func TestValidLayoutV2AndSharedState(t *testing.T) {
	raw := json.RawMessage(`{"workspaceTabs":[{"id":"workspace-1","index":1,"name":"production","layout":{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[{"id":"ssh-1","type":"ssh","title":"shell","connId":7,"labelNumber":3}],"activeTabId":"ssh-1"}},"focusedPaneId":"root"}},{"id":"workspace-2","index":2,"name":"production","layout":{"tree":{"type":"leaf","id":"pane-2"},"panes":{"pane-2":{"tabs":[],"activeTabId":null}},"focusedPaneId":"pane-2"}}]}`)
	if !validLayoutJSON(2, raw) {
		t.Fatal("expected valid schema v2 layout")
	}
	shared, err := sharedLayoutJSON(2, raw)
	if err != nil {
		t.Fatal(err)
	}
	var decoded savedWorkspaceLayout
	if err := json.Unmarshal(shared, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, workspace := range decoded.WorkspaceTabs {
		if workspace.Layout.FocusedPaneID != "" {
			t.Fatalf("focused pane leaked into shared layout: %#v", workspace)
		}
		for _, pane := range workspace.Layout.Panes {
			if pane.ActiveTabID != "" {
				t.Fatalf("active session tab leaked into shared layout: %#v", pane)
			}
		}
	}
}

func TestLayoutV2RejectsDuplicateWorkspaceIdentityAndTerminalIDs(t *testing.T) {
	tests := []string{
		`{"workspaceTabs":[{"id":"same","index":1,"name":"one","layout":{"tree":{"type":"leaf","id":"one"},"panes":{"one":{"tabs":[]}}}},{"id":"same","index":2,"name":"two","layout":{"tree":{"type":"leaf","id":"two"},"panes":{"two":{"tabs":[]}}}}]}`,
		`{"workspaceTabs":[{"id":"one","index":1,"name":"one","layout":{"tree":{"type":"leaf","id":"one"},"panes":{"one":{"tabs":[]}}}},{"id":"two","index":1,"name":"two","layout":{"tree":{"type":"leaf","id":"two"},"panes":{"two":{"tabs":[]}}}}]}`,
		`{"workspaceTabs":[{"id":"one","index":1,"name":"one","layout":{"tree":{"type":"leaf","id":"one"},"panes":{"one":{"tabs":[{"id":"ssh-duplicate","type":"ssh","title":"one","connId":1}]}}}},{"id":"two","index":2,"name":"two","layout":{"tree":{"type":"leaf","id":"two"},"panes":{"two":{"tabs":[{"id":"ssh-duplicate","type":"ssh","title":"two","connId":1}]}}}}]}`,
	}
	for _, raw := range tests {
		if validLayoutJSON(2, json.RawMessage(raw)) {
			t.Fatalf("accepted invalid schema v2 layout: %s", raw)
		}
	}
}

func TestLayoutV1RemainsReadableDuringSchemaV2Rollout(t *testing.T) {
	raw := json.RawMessage(`{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[],"activeTabId":null}},"focusedPaneId":"root"}`)
	if !validLayoutJSON(1, raw) {
		t.Fatal("schema v1 layout must remain valid during rollout")
	}
}

func TestLayoutV2SaveAndGetRoundTrip(t *testing.T) {
	st := newQuickConnectTestStore(t)
	userID, err := st.CreateUser("workspace-owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	connectionID, err := st.CreateConnection(&store.Connection{Name: "production", Host: "10.0.0.20", Port: 22, Username: "owner", AuthMethod: "password", CreatedBy: userID})
	if err != nil {
		t.Fatal(err)
	}
	h := &LayoutHandler{Store: st}
	token := testJWT(t, userID, "user")
	body := []byte(fmt.Sprintf(`{"schema_version":2,"revision":0,"layout":{"workspaceTabs":[{"id":"workspace-1","index":1,"name":"production","layout":{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[{"id":"ssh-original","type":"ssh","title":"production","connId":%d,"labelNumber":8}],"activeTabId":"ssh-original"}},"focusedPaneId":"root"}},{"id":"workspace-2","index":2,"name":"production","layout":{"tree":{"type":"leaf","id":"pane-2"},"panes":{"pane-2":{"tabs":[],"activeTabId":null}},"focusedPaneId":"pane-2"}}]}}`, connectionID))
	req := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Save)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", res.Code, res.Body.String())
	}

	stored, err := st.GetUserLayout(userID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.SchemaVersion != 2 || stored.Revision != 1 {
		t.Fatalf("stored envelope = schema %d revision %d, want schema 2 revision 1", stored.SchemaVersion, stored.Revision)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/layout", nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getRes := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc(h.Get)).ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", getRes.Code, getRes.Body.String())
	}
	var response struct {
		SchemaVersion int                  `json:"schema_version"`
		Revision      int64                `json:"revision"`
		Layout        savedWorkspaceLayout `json:"layout"`
	}
	if err := json.NewDecoder(getRes.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.SchemaVersion != 2 || response.Revision != 1 || len(response.Layout.WorkspaceTabs) != 2 {
		t.Fatalf("response = %#v", response)
	}
	first := response.Layout.WorkspaceTabs[0]
	if first.Index != 1 || first.Name != "production" || first.Layout.Panes["root"].Tabs[0].ID != "ssh-original" {
		t.Fatalf("first workspace did not round trip: %#v", first)
	}
	if first.Layout.FocusedPaneID != "" || first.Layout.Panes["root"].ActiveTabID != "" {
		t.Fatalf("browser-local state was persisted: %#v", first.Layout)
	}
}

func TestLayoutV2RejectsUnavailableConnectionInAnyWorkspace(t *testing.T) {
	st := newQuickConnectTestStore(t)
	ownerID, err := st.CreateUser("workspace-connection-owner", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	viewerID, err := st.CreateUser("workspace-viewer", "hash", "user")
	if err != nil {
		t.Fatal(err)
	}
	connectionID, err := st.CreateConnection(&store.Connection{Name: "private", Host: "10.0.0.21", Port: 22, Username: "owner", AuthMethod: "password", CreatedBy: ownerID})
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(fmt.Sprintf(`{"schema_version":2,"revision":0,"layout":{"workspaceTabs":[{"id":"workspace-1","index":1,"name":"one","layout":{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[]}}}},{"id":"workspace-2","index":2,"name":"two","layout":{"tree":{"type":"leaf","id":"pane-2"},"panes":{"pane-2":{"tabs":[{"id":"ssh-private","type":"ssh","title":"private","connId":%d}]}}}}]}}`, connectionID))
	req := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testJWT(t, viewerID, "user"))
	res := httptest.NewRecorder()
	auth.Middleware(http.HandlerFunc((&LayoutHandler{Store: st}).Save)).ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s; want %d", res.Code, res.Body.String(), http.StatusForbidden)
	}
}
