package main

import (
	"bytes"
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
