package main

import (
	"bytes"
	"net/http/httptest"
	"testing"
)

func TestJWTSigningKeyIsStableAndDomainSeparated(t *testing.T) {
	first := deriveJWTSigningKey("deployment-secret")
	second := deriveJWTSigningKey("deployment-secret")
	other := deriveJWTSigningKey("other-secret")
	if len(first) != 32 || !bytes.Equal(first, second) {
		t.Fatal("same deployment secret must derive the same 32-byte JWT key")
	}
	if bytes.Equal(first, other) || bytes.Equal(first, []byte("deployment-secret")) {
		t.Fatal("JWT key must be derived and distinct across deployment secrets")
	}
}

func TestSPAHandlerCachePolicyKeepsHTMLFreshAndHashedAssetsImmutable(t *testing.T) {
	handler := spaHandler()
	for _, path := range []string{"/", "/index.html", "/missing/client-route"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest("GET", path, nil))
		if got := recorder.Header().Get("Cache-Control"); got != "no-store, max-age=0" {
			t.Fatalf("%s cache policy = %q, want no-store", path, got)
		}
	}

	assets, err := frontendDist.ReadDir("frontend/dist/assets")
	if err != nil || len(assets) == 0 {
		t.Fatal("embedded frontend assets are unavailable")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest("GET", "/assets/"+assets[0].Name(), nil))
	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("hashed asset cache policy = %q", got)
	}
}
