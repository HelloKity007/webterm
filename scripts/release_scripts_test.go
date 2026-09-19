package scripts

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionReleasePreflightsBeforeStopping(t *testing.T) {
	for _, tc := range []struct {
		file   string
		checks []string
	}{
		{"release-promote.sh", []string{`lan_preflight_production_binary "$next_binary"`, `lan_preflight_production_binary "$LAN_BINARY"`}},
		{"release-rollback.sh", []string{`lan_preflight_production_binary "$next_binary"`}},
	} {
		data, err := os.ReadFile(tc.file)
		if err != nil {
			t.Fatal(err)
		}
		body := string(data)
		stop := strings.Index(body, "lan_stop_pid webterm")
		for _, check := range tc.checks {
			at := strings.Index(body, check)
			if at < 0 || at > stop {
				t.Errorf("%s must run %s before stopping", tc.file, check)
			}
		}
	}
}

func TestIncompatibleReleaseLeavesRunningServiceUntouched(t *testing.T) {
	library, err := filepath.Abs("lan-lib.sh")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, script               string
		candidateGood, currentGood bool
	}{
		{"bad candidate", "release-promote.sh", false, true},
		{"bad automatic rollback", "release-promote.sh", true, false},
		{"bad manual rollback", "release-rollback.sh", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			write := func(name, body string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0700); err != nil {
					t.Fatal(err)
				}
			}
			binary := func(good bool) string {
				help := "-database"
				if good {
					help += " -tmux-binary -tmux-socket"
				}
				return "#!/bin/sh\necho '" + help + "'\n"
			}
			write("candidate", binary(tc.candidateGood))
			write("current", binary(tc.currentGood))
			write("previous", binary(false))
			write("approved", "candidate\n")
			write("previous.version", "previous\n")
			write("tmux", "#!/bin/sh\necho 'tmux 3.7c'\n")
			data, err := os.ReadFile(tc.script)
			if err != nil {
				t.Fatal(err)
			}
			write(tc.script, string(data))
			write("release-lib.sh", `source "`+library+`"
LAN_BINARY="$QA_ROOT/current"
LAN_RELEASE_BINARY="$QA_ROOT/candidate"
RELEASE_PRODUCTION_DIR="$QA_ROOT"
RELEASE_PREVIOUS_BINARY="$QA_ROOT/previous"
RELEASE_PREVIOUS_VERSION="$QA_ROOT/previous.version"
RELEASE_APPROVED_SHA="$QA_ROOT/approved"
lan_check() { :; }
release_candidate_sha() { echo candidate; }
release_exact_rb_ref() { echo rb-fixture; }
release_wait_health() { :; }
lan_stop_pid() { touch "$QA_ROOT/STOPPED"; }
lan_start_production() { touch "$QA_ROOT/STARTED"; }
`)
			cmd := exec.Command("bash", filepath.Join(root, tc.script))
			cmd.Env = append(os.Environ(), "QA_ROOT="+root, "WEBTERM_ROOT="+root, "WEBTERM_PRODUCTION_TMUX_BINARY="+filepath.Join(root, "tmux"), "WEBTERM_PRODUCTION_TMUX_SOCKET=webterm-production-fixture")
			out, err := cmd.CombinedOutput()
			if err == nil || !strings.Contains(string(out), "does not support pinned tmux") {
				t.Fatalf("expected preflight failure: %v %s", err, out)
			}
			for _, marker := range []string{"STOPPED", "STARTED"} {
				if _, err := os.Stat(filepath.Join(root, marker)); !os.IsNotExist(err) {
					t.Fatalf("service mutated: %s", marker)
				}
			}
			unchanged, _ := os.ReadFile(filepath.Join(root, "current"))
			if string(unchanged) != binary(tc.currentGood) {
				t.Fatal("running binary overwritten")
			}
		})
	}
}

func TestProductionTmuxOverrideValidation(t *testing.T) {
	for _, tc := range []struct {
		name, binary, socket, version string
		fail                          bool
	}{
		{"legacy", "", "", "", false},
		{"paired", "fixture", "webterm-production-fixed", "tmux 3.7c", false},
		{"missing socket", "fixture", "", "tmux 3.7c", true},
		{"missing binary", "", "webterm-production-fixed", "", true},
		{"wrong scope", "fixture", "webterm-release-test-fixed", "tmux 3.7c", true},
		{"old version", "fixture", "webterm-production-fixed", "tmux 3.5a", true},
		{"missing executable", "/does-not-exist/tmux", "webterm-production-fixed", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.binary == "fixture" {
				tc.binary = filepath.Join(t.TempDir(), "tmux")
				if err := os.WriteFile(tc.binary, []byte("#!/bin/sh\nprintf '%s\\n' '"+tc.version+"'\n"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.Command("bash", "-c", `source ./lan-lib.sh; lan_validate_production_tmux`)
			cmd.Env = append(os.Environ(), "WEBTERM_PRODUCTION_TMUX_BINARY="+tc.binary, "WEBTERM_PRODUCTION_TMUX_SOCKET="+tc.socket)
			out, err := cmd.CombinedOutput()
			if (err != nil) != tc.fail {
				t.Fatalf("err=%v output=%s", err, out)
			}
		})
	}
}

func TestProductionStartPassesOverridesAndRejectsLegacyBinary(t *testing.T) {
	for _, supported := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy rejected", true: "flags forwarded"}[supported], func(t *testing.T) {
			root := t.TempDir()
			if err := os.Mkdir(filepath.Join(root, "runtime"), 0700); err != nil {
				t.Fatal(err)
			}
			help := "-database"
			if supported {
				help += " -tmux-binary -tmux-socket"
			}
			if err := os.WriteFile(filepath.Join(root, "webterm"), []byte("#!/bin/sh\nprintf '%s\\n' '"+help+"'\n"), 0700); err != nil {
				t.Fatal(err)
			}
			tmux := filepath.Join(root, "tmux")
			if err := os.WriteFile(tmux, []byte("#!/bin/sh\necho 'tmux 3.7c'\n"), 0700); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command("bash", "-c", `source ./lan-lib.sh; setsid() { printf '%s\n' "$@" > "$LAN_ROOT/arguments"; }; lan_start_production; wait`)
			cmd.Env = append(os.Environ(), "WEBTERM_ROOT="+root, "WEBTERM_PRODUCTION_TMUX_BINARY="+tmux, "WEBTERM_PRODUCTION_TMUX_SOCKET=webterm-production-fixed")
			out, err := cmd.CombinedOutput()
			if !supported {
				if err == nil || !strings.Contains(string(out), "does not support pinned tmux") {
					t.Fatalf("expected refusal: %v %s", err, out)
				}
				return
			}
			if err != nil {
				t.Fatalf("%v %s", err, out)
			}
			args, err := os.ReadFile(filepath.Join(root, "arguments"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(args), "-tmux-binary\n"+tmux+"\n-tmux-socket\nwebterm-production-fixed\n") {
				t.Fatalf("missing overrides: %s", args)
			}
		})
	}
}

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
		"remote_ip 192.168.0.0/16",
	} {
		if !strings.Contains(contents, expected) {
			t.Fatalf("Caddyfile is missing %q", expected)
		}
	}
	if strings.Count(contents, "remote_ip 192.168.0.0/16") != 2 {
		t.Fatal("Caddyfile must apply the private LAN allowlist to both HTTPS routes")
	}
	if strings.Contains(contents, "192.168.11.0/24") {
		t.Fatal("Caddyfile retains the obsolete single-subnet allowlist")
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
		"-test-auto-login",
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
