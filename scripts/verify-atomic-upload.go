//go:build ignore

// Owned loopback fixture only. Credentials are read from the environment, never logged.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/xufanchn/webterm/sftpmgr"
	"golang.org/x/crypto/ssh"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"time"
)

type cancelReader struct {
	cancel context.CancelFunc
	chunks int
}

func (r *cancelReader) Read(p []byte) (int, error) {
	if r.chunks == 16 {
		r.cancel()
		return 0, context.Canceled
	}
	r.chunks++
	for i := range p {
		p[i] = byte(r.chunks)
	}
	return len(p), nil
}
func run() (err error) {
	password := os.Getenv("WEBTERM_LOCAL_SSH_PASSWORD")
	if password == "" {
		return errors.New("SSH password env required")
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
	dir, err := os.MkdirTemp("", "webterm-owned-atomic-upload-")
	if err != nil {
		return err
	}
	defer func() {
		if err == nil && filepath.Dir(dir) == os.TempDir() && strings.HasPrefix(filepath.Base(dir), "webterm-owned-atomic-upload-") {
			err = os.RemoveAll(dir)
		} else {
			fmt.Fprintln(os.Stderr, "retained fixture", dir)
		}
	}()
	target := filepath.Join(dir, "target")
	original := []byte("original content remains intact")
	if err = os.WriteFile(target, original, 0600); err != nil {
		return err
	}
	client, err := sftpmgr.NewClient(conn)
	if err != nil {
		return err
	}
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	start := time.Now()
	cancelErr := client.UploadAtomic(ctx, target, &cancelReader{cancel: cancel})
	cancelDuration := time.Since(start).Milliseconds()
	if !errors.Is(cancelErr, context.Canceled) {
		return fmt.Errorf("expected cancellation, got %v", cancelErr)
	}
	after, err := os.ReadFile(target)
	if err != nil {
		return err
	}
	if sha256.Sum256(after) != sha256.Sum256(original) {
		return errors.New("cancel changed original")
	}
	partials, err := filepath.Glob(filepath.Join(dir, ".webterm-upload-*.partial"))
	if err != nil || len(partials) != 0 {
		return fmt.Errorf("partial cleanup failed count=%d err=%v", len(partials), err)
	}
	session, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("shared SSH unavailable: %w", err)
	}
	err = session.Run("true")
	_ = session.Close()
	if err != nil {
		return err
	}
	retry, err := sftpmgr.NewClient(conn)
	if err != nil {
		return err
	}
	defer retry.Close()
	payload := strings.Repeat("explicit retry content\n", 4096)
	if err = retry.UploadAtomic(context.Background(), target, strings.NewReader(payload)); err != nil {
		return err
	}
	f, err := retry.Open(target)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(h, f)
	_ = f.Close()
	if err != nil {
		return err
	}
	expected := sha256.Sum256([]byte(payload))
	if fmt.Sprintf("%x", h.Sum(nil)) != fmt.Sprintf("%x", expected) {
		return errors.New("retry SHA mismatch")
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "PASS", "target": "owned loopback SSH fixture", "cancel_ms": cancelDuration, "original_preserved": true, "partials_removed": true, "shared_ssh_reusable": true, "explicit_retry_sha256": fmt.Sprintf("%x", expected)})
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
