//go:build ignore

// Run from the repository root after securely exporting WEBTERM_LOCAL_SSH_PASSWORD.
// This benchmark only lists its own local temporary files over real loopback SSH/SFTP.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/xufanchn/webterm/sftpmgr"
	"golang.org/x/crypto/ssh"
)

type sample struct {
	Count          int     `json:"count"`
	Iteration      int     `json:"iteration"`
	Milliseconds   float64 `json:"milliseconds"`
	AllocatedBytes uint64  `json:"allocated_bytes"`
	HeapBefore     uint64  `json:"heap_before_bytes"`
	HeapAfter      uint64  `json:"heap_after_bytes"`
	ProcessMemory  string  `json:"proc_status_memory"`
}

func memory() string {
	data, _ := os.ReadFile("/proc/self/status")
	var lines []string
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmRSS:") || strings.HasPrefix(line, "VmHWM:") {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "; ")
}

func run() (err error) {
	password := os.Getenv("WEBTERM_LOCAL_SSH_PASSWORD")
	if password == "" {
		return fmt.Errorf("WEBTERM_LOCAL_SSH_PASSWORD is required (never printed)")
	}
	u, err := user.Current()
	if err != nil {
		return err
	}
	public, err := os.ReadFile("/etc/ssh/ssh_host_ed25519_key.pub")
	if err != nil {
		return err
	}
	key, _, _, _, err := ssh.ParseAuthorizedKey(public)
	if err != nil {
		return err
	}
	conn, err := ssh.Dial("tcp", "127.0.0.1:22", &ssh.ClientConfig{User: u.Username, Auth: []ssh.AuthMethod{ssh.Password(password)}, HostKeyCallback: ssh.FixedHostKey(key), HostKeyAlgorithms: []string{ssh.KeyAlgoED25519}, Timeout: 10 * time.Second})
	if err != nil {
		return err
	}
	defer conn.Close()
	client, err := sftpmgr.NewClient(conn)
	if err != nil {
		return err
	}
	fixture, err := os.MkdirTemp("", "webterm-owned-sftp-directory-")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			fmt.Fprintln(os.Stderr, "FAIL: retaining owned fixture:", fixture)
			return
		}
		// Only this freshly allocated absolute path is eligible for cleanup.
		if filepath.Dir(fixture) != os.TempDir() || !strings.HasPrefix(filepath.Base(fixture), "webterm-owned-sftp-directory-") {
			err = fmt.Errorf("invalid cleanup target")
			return
		}
		err = os.RemoveAll(fixture)
	}()
	if err = os.Chmod(fixture, 0700); err != nil {
		return err
	}
	var samples []sample
	for _, count := range []int{10000, 50000} {
		dir := filepath.Join(fixture, fmt.Sprint(count))
		if err = os.Mkdir(dir, 0700); err != nil {
			return err
		}
		for i := 0; i < count; i++ {
			var f *os.File
			f, err = os.OpenFile(filepath.Join(dir, fmt.Sprintf("entry-%06d.txt", i)), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				return err
			}
			if err = f.Close(); err != nil {
				return err
			}
		}
		for iteration := 1; iteration <= 5; iteration++ {
			runtime.GC()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			start := time.Now()
			entries, listErr := client.ListDir(dir)
			elapsed := time.Since(start)
			if listErr != nil {
				return listErr
			}
			if len(entries) != count {
				return fmt.Errorf("count=%d wanted=%d", len(entries), count)
			}
			for i, entry := range entries {
				if entry.Name != fmt.Sprintf("entry-%06d.txt", i) || entry.IsDir || entry.Size != 0 {
					return fmt.Errorf("incorrect entry at %d", i)
				}
			}
			runtime.ReadMemStats(&after)
			samples = append(samples, sample{count, iteration, float64(elapsed.Microseconds()) / 1000, after.TotalAlloc - before.TotalAlloc, before.HeapAlloc, after.HeapAlloc, memory()})
			fmt.Fprintf(os.Stderr, "entries=%d repeat=%d duration_ms=%.3f\n", count, iteration, float64(elapsed.Microseconds())/1000)
		}
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "PASS", "scope": "backend ListDir over authenticated real loopback SSH/SFTP; not browser/HTTP acceptance", "timestamp": time.Now().UTC(), "fixture": fixture, "fixture_cleanup": "removed after successful return; stderr/exit must also be checked", "files": "60000 real empty files, directory mode0700/file0600", "memory_method": "Go MemStats before/after each validated listing (includes entry validation allocation); /proc/self/status VmRSS instantaneous and VmHWM process-lifetime peak including fixture creation; excludes sshd/browser", "samples": samples})
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "benchmark failed:", err)
		os.Exit(1)
	}
}
