package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validEncryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const validQuickConnect = "local_quick_connect:\n  host: 127.0.0.1\n  port: 22\n  username: pgz\n  password_env: WEBTERM_LOCAL_SSH_PASSWORD\n"

func writeTestConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadUsesExplicitLoopbackAddress(t *testing.T) {
	path := writeTestConfig(t, "listen_addr: 127.0.0.1:18888\nencryption_key: "+validEncryptionKey+"\n"+validQuickConnect)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ListenAddr != "127.0.0.1:18888" {
		t.Fatalf("ListenAddr = %q, want loopback address", cfg.ListenAddr)
	}
}

func TestLoadDefaultsToLoopbackAddress(t *testing.T) {
	path := writeTestConfig(t, "encryption_key: "+validEncryptionKey+"\n"+validQuickConnect)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ListenAddr != "127.0.0.1:8888" {
		t.Fatalf("ListenAddr = %q, want 127.0.0.1:8888", cfg.ListenAddr)
	}
}

func TestLoadRejectsNonLoopbackListener(t *testing.T) {
	path := writeTestConfig(t, "listen_addr: 0.0.0.0:8888\nencryption_key: "+validEncryptionKey+"\n")

	if _, err := Load(path); err == nil {
		t.Fatal("Load() error = nil, want non-loopback listener to be rejected")
	}
}

func TestLoadRejectsDefaultOrInvalidEncryptionKey(t *testing.T) {
	for _, key := range []string{strings.Repeat("0", 64), "not-hex"} {
		t.Run(key, func(t *testing.T) {
			path := writeTestConfig(t, "encryption_key: "+key+"\n")
			if _, err := Load(path); err == nil {
				t.Fatal("Load() error = nil, want invalid encryption key to be rejected")
			}
		})
	}
}

func TestLoadRejectsIncompleteLocalQuickConnect(t *testing.T) {
	path := writeTestConfig(t, "encryption_key: "+validEncryptionKey+"\nlocal_quick_connect:\n  host: 127.0.0.1\n  port: 22\n")

	if _, err := Load(path); err == nil {
		t.Fatal("Load() error = nil, want incomplete local_quick_connect to be rejected")
	}
}

func TestLoadUsesBoundedQuickConnectSessionLimit(t *testing.T) {
	path := writeTestConfig(t, "encryption_key: "+validEncryptionKey+"\nlocal_quick_connect:\n  host: 127.0.0.1\n  port: 22\n  username: pgz\n  password_env: WEBTERM_LOCAL_SSH_PASSWORD\n  max_sessions: 1000\n")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LocalQuickConnect.MaxSessions != 1000 {
		t.Fatalf("MaxSessions = %d, want 1000", cfg.LocalQuickConnect.MaxSessions)
	}
}

func TestLoadDefaultsQuickConnectSessionLimitToThirty(t *testing.T) {
	path := writeTestConfig(t, "encryption_key: "+validEncryptionKey+"\n"+validQuickConnect)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LocalQuickConnect.MaxSessions != 30 {
		t.Fatalf("MaxSessions = %d, want default 30", cfg.LocalQuickConnect.MaxSessions)
	}
}

func TestLoadRejectsUnboundedQuickConnectSessionLimit(t *testing.T) {
	path := writeTestConfig(t, "encryption_key: "+validEncryptionKey+"\nlocal_quick_connect:\n  host: 127.0.0.1\n  port: 22\n  username: pgz\n  password_env: WEBTERM_LOCAL_SSH_PASSWORD\n  max_sessions: 1001\n")
	if _, err := Load(path); err == nil {
		t.Fatal("Load() error = nil, want excessive max_sessions to be rejected")
	}
}

func TestLoadRejectsStrictHostKeyCheckWithoutKnownHostsFile(t *testing.T) {
	path := writeTestConfig(t, "encryption_key: "+validEncryptionKey+"\nssh_host_key_check: true\nssh_known_hosts: "+filepath.Join(t.TempDir(), "missing")+"\n"+validQuickConnect)

	if _, err := Load(path); err == nil {
		t.Fatal("Load() error = nil, want missing strict host key file to be rejected")
	}
}
