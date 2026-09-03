package scripts

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const scriptTestKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func writeScriptFile(t *testing.T, root, name, contents string, mode os.FileMode) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, []byte(contents), mode); err != nil {
		t.Fatal(err)
	}
}

func TestLanUpCheckRejectsWorldReadableConfig(t *testing.T) {
	root := t.TempDir()
	writeScriptFile(t, root, "config.yaml", "listen_addr: 127.0.0.1:8888\nencryption_key: "+scriptTestKey+"\n", 0o644)
	if err := os.Chmod(filepath.Join(root, "config.yaml"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeScriptFile(t, root, "lan-secrets.env", "WEBTERM_LOCAL_SSH_PASSWORD=test-only\n", 0o600)

	cmd := exec.Command("bash", filepath.Join(".", "lan-up.sh"), "check")
	cmd.Dir = "."
	cmd.Env = append(os.Environ(), "WEBTERM_ROOT="+root)
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("lan-up check succeeded with insecure config permissions: %s", output)
	}
	if !strings.Contains(string(output), "config.yaml must have permissions 600") {
		t.Fatalf("lan-up check output = %q, want config permission error", output)
	}
}
