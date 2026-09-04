package sshmgr

import (
	"os"
	"strconv"
	"testing"
)

// This opt-in test exercises the same SSH client used by the WebSocket
// handler against a LAN host without ever printing the credential.
func TestIntegrationLANPasswordConnection(t *testing.T) {
	host, username, password := os.Getenv("WEBTERM_SSH_TEST_HOST"), os.Getenv("WEBTERM_SSH_TEST_USERNAME"), os.Getenv("WEBTERM_SSH_TEST_PASSWORD")
	if host == "" || username == "" || password == "" {
		t.Skip("set WEBTERM_SSH_TEST_HOST, WEBTERM_SSH_TEST_USERNAME and WEBTERM_SSH_TEST_PASSWORD to run")
	}
	knownHosts := os.Getenv("WEBTERM_SSH_TEST_KNOWN_HOSTS")
	if knownHosts != "" {
		SetStrictHostKeyCheck(true)
		SetKnownHostsPath(knownHosts)
		t.Cleanup(func() { SetStrictHostKeyCheck(false); SetKnownHostsPath("") })
	}
	port := 22
	if raw := os.Getenv("WEBTERM_SSH_TEST_PORT"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			t.Fatal(err)
		}
		port = value
	}
	client, err := NewClient(host, port, username, password, "", "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := client.Connect(); err != nil {
		t.Fatalf("LAN SSH client connection failed: %v", err)
	}
}
