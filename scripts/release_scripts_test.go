package scripts

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleaseScriptsHaveValidShellSyntax(t *testing.T) {
	files := []string{
		"lan-lib.sh",
		"release-lib.sh",
		"release-deploy.sh",
		"release-approve.sh",
		"release-promote.sh",
		"release-rollback.sh",
		"release-status.sh",
	}
	for _, file := range files {
		t.Run(file, func(t *testing.T) {
			cmd := exec.Command("bash", "-n", file)
			cmd.Dir = "."
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("bash -n %s: %v\n%s", file, err, output)
			}
		})
	}
}

func TestDualEnvironmentRoutesUseSeparateLoopbackBackends(t *testing.T) {
	caddyfile, err := os.ReadFile(filepath.Join("..", "Caddyfile"))
	if err != nil {
		t.Fatal(err)
	}
	contents := string(caddyfile)
	for _, expected := range []string{
		"https://:9443",
		"reverse_proxy 127.0.0.1:8888",
		"https://:9444",
		"reverse_proxy 127.0.0.1:8889",
	} {
		if !strings.Contains(contents, expected) {
			t.Fatalf("Caddyfile is missing %q", expected)
		}
	}
}

func TestReleasePromotionIsApprovalAndReleaseBranchGated(t *testing.T) {
	promote, err := os.ReadFile("release-promote.sh")
	if err != nil {
		t.Fatal(err)
	}
	contents := string(promote)
	for _, expected := range []string{
		"lan_check",
		"RELEASE_APPROVED_SHA",
		"approval does not match the current candidate",
		"release_exact_rb_ref",
		"lan_stop_pid webterm",
	} {
		if !strings.Contains(contents, expected) {
			t.Fatalf("release-promote.sh is missing safety gate %q", expected)
		}
	}
}

func TestProductionStartLoadsSecretsAndSupportsLegacyRollbackBinary(t *testing.T) {
	promote, err := os.ReadFile("release-promote.sh")
	if err != nil {
		t.Fatal(err)
	}
	rollback, err := os.ReadFile("release-rollback.sh")
	if err != nil {
		t.Fatal(err)
	}
	lanLibrary, err := os.ReadFile("lan-lib.sh")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(promote), "lan_check") || !strings.Contains(string(rollback), "lan_check") {
		t.Fatal("production promote and rollback must load validated deployment secrets")
	}
	for _, expected := range []string{`start_args=(-config "$LAN_CONFIG")`, `grep -q -- "-database"`, `start_args+=(-database "$LAN_ROOT/webterm.db" -environment production)`} {
		if !strings.Contains(string(lanLibrary), expected) {
			t.Fatalf("lan_start_production is missing legacy-compatible argument handling %q", expected)
		}
	}
}

func TestReleaseRuntimePreservesSharedTmuxSessions(t *testing.T) {
	lanLibrary, err := os.ReadFile("lan-lib.sh")
	if err != nil {
		t.Fatal(err)
	}
	contents := string(lanLibrary)
	for _, expected := range []string{
		"-listen-addr 127.0.0.1:8889",
		"-environment release-test",
		"-preserve-terminal-sessions",
	} {
		if !strings.Contains(contents, expected) {
			t.Fatalf("release-test start command is missing %q", expected)
		}
	}
}

func TestProcessStopEscalationTargetsOnlyTheRecordedPID(t *testing.T) {
	lanLibrary, err := os.ReadFile("lan-lib.sh")
	if err != nil {
		t.Fatal(err)
	}
	contents := string(lanLibrary)
	if !strings.Contains(contents, `kill -KILL "$pid"`) {
		t.Fatal("bounded graceful shutdown does not escalate against the exact PID")
	}
	for _, forbidden := range []string{"pkill", "killall"} {
		if strings.Contains(contents, forbidden) {
			t.Fatalf("process management must not use broad command %q", forbidden)
		}
	}
}
