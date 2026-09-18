package sftpmgr

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pkg/sftp"
)

func uploadTestClient(t *testing.T) *Client {
	t.Helper()
	a, b := net.Pipe()
	server, err := sftp.NewServer(a)
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = server.Serve(); _ = server.Close() }()
	client, err := sftp.NewClientPipe(b, b)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close(); _ = a.Close(); _ = b.Close() })
	return &Client{conn: client}
}

type brokenUpload struct{}

type privateUploadReader struct {
	t       *testing.T
	dir     string
	checked bool
}

func (r *privateUploadReader) Read(p []byte) (int, error) {
	if r.checked {
		return 0, io.EOF
	}
	r.checked = true
	files, _ := filepath.Glob(filepath.Join(r.dir, ".webterm-upload-*.partial"))
	if len(files) != 1 {
		r.t.Fatal("missing partial")
	}
	info, err := os.Stat(files[0])
	if err != nil {
		r.t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		r.t.Fatalf("partial exposed before first byte: %o", info.Mode().Perm())
	}
	return copy(p, "private"), io.EOF
}

func TestUploadPartialPrivateBeforeReading(t *testing.T) {
	c := uploadTestClient(t)
	dir := t.TempDir()
	if err := c.UploadAtomic(context.Background(), filepath.Join(dir, "target"), &privateUploadReader{t: t, dir: dir}); err != nil {
		t.Fatal(err)
	}
}

func (brokenUpload) Read([]byte) (int, error) { return 0, errors.New("fixture interrupted") }

func TestUploadFailurePreservesDestination(t *testing.T) {
	c := uploadTestClient(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := c.UploadAtomic(context.Background(), target, io.MultiReader(strings.NewReader("partial"), brokenUpload{})); err == nil {
		t.Fatal("expected interrupted upload")
	}
	got, _ := os.ReadFile(target)
	if string(got) != "original" {
		t.Fatalf("original overwritten: %q", got)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatal("partial leaked")
	}
}
func TestUploadCancelledBeforeStart(t *testing.T) {
	c := uploadTestClient(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	target := filepath.Join(t.TempDir(), "target")
	if err := c.UploadAtomic(ctx, target, strings.NewReader("new")); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("cancelled upload created target")
	}
}

func TestUploadAtomicCommitPreservesModeAndRejectsSymlink(t *testing.T) {
	c := uploadTestClient(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("original"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := c.UploadAtomic(context.Background(), target, strings.NewReader("complete")); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(target)
	info, _ := os.Stat(target)
	if string(got) != "complete" || info.Mode().Perm() != 0640 {
		t.Fatal("content/mode mismatch")
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := c.UploadAtomic(context.Background(), link, strings.NewReader("unsafe")); err == nil {
		t.Fatal("symlink accepted")
	}
	got, _ = os.ReadFile(target)
	if string(got) != "complete" {
		t.Fatal("symlink target modified")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Fatal("partial leaked")
	}
}
