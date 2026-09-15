package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCleanLocalPathRejectsNULWithoutChangingScope(t *testing.T) {
	if _, err := cleanLocalPath("/tmp/a\x00b"); err == nil {
		t.Fatal("expected NUL path rejection")
	}
	got, err := cleanLocalPath("/tmp/../tmp/example")
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Clean("/tmp/../tmp/example") {
		t.Fatalf("unexpected clean path: %q", got)
	}
}

func TestRemoveLocalAllRecursivelyWithoutFollowingSymlink(t *testing.T) {
	root := t.TempDir()
	tree := filepath.Join(root, "tree")
	outside := filepath.Join(root, "outside.txt")
	if err := os.MkdirAll(filepath.Join(tree, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "nested", "inside.txt"), []byte("inside"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Symlink(outside, filepath.Join(tree, "link")); err != nil {
			t.Fatal(err)
		}
	}
	if err := removeLocalAll(tree); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("tree still exists: %v", err)
	}
	data, err := os.ReadFile(outside)
	if err != nil || string(data) != "outside" {
		t.Fatalf("symlink target was affected: data=%q err=%v", data, err)
	}
}

func TestRemoveLocalAllProtectsRoot(t *testing.T) {
	root := string(os.PathSeparator)
	if runtime.GOOS == "windows" {
		root = filepath.VolumeName(os.TempDir()) + string(os.PathSeparator)
	}
	if err := removeLocalAll(root); err == nil {
		t.Fatal("expected filesystem root protection")
	}
}

func TestCopyLocalDirectoryAndRejectNestedDestination(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	if err := os.MkdirAll(filepath.Join(source, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "nested", "file.txt"), []byte("payload"), 0640); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(root, "copy")
	if err := copyLocal(source, destination); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(destination, "nested", "file.txt"))
	if err != nil || string(data) != "payload" {
		t.Fatalf("copy mismatch: %q %v", data, err)
	}
	if err := copyLocal(source, filepath.Join(source, "child")); err == nil {
		t.Fatal("expected nested destination rejection")
	}
}

func TestCopyLocalRejectsSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink privileges vary")
	}
	root := t.TempDir()
	target := filepath.Join(root, "target")
	link := filepath.Join(root, "link")
	if err := os.WriteFile(target, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := copyLocal(link, filepath.Join(root, "copy")); err == nil {
		t.Fatal("expected symlink rejection")
	}
}

func TestCopyLocalFailureRemovesPartialDestinationAndKeepsSource(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink privileges vary")
	}
	root := t.TempDir()
	source := filepath.Join(root, "source")
	destination := filepath.Join(root, "destination")
	if err := os.Mkdir(source, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "a-file.txt"), []byte("copied-before-failure"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(source, "a-file.txt"), filepath.Join(source, "z-link")); err != nil {
		t.Fatal(err)
	}
	if err := copyLocal(source, destination); err == nil || !strings.Contains(err.Error(), "symbolic") {
		t.Fatalf("expected symlink failure, got %v", err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("partial destination remains: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(source, "a-file.txt")); err != nil || string(data) != "copied-before-failure" {
		t.Fatalf("source damaged: %q %v", data, err)
	}
}

func TestCopyLocalSameFileDoesNotTruncate(t *testing.T) {
	file := filepath.Join(t.TempDir(), "same.txt")
	if err := os.WriteFile(file, []byte("must-survive"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyLocal(file, file); err == nil || !strings.Contains(err.Error(), "same") {
		t.Fatalf("expected same-path rejection, got %v", err)
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "must-survive" {
		t.Fatalf("source was damaged: %q %v", data, err)
	}
}

func TestLocalFSUploadAndDownloadStream(t *testing.T) {
	target := filepath.Join(t.TempDir(), "报告.bin")
	payload := bytes.Repeat([]byte("stream-payload"), 8192)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("path", target); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", "报告.bin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	upload := httptest.NewRequest(http.MethodPost, "/api/local-files/upload", &body)
	upload.Header.Set("Content-Type", writer.FormDataContentType())
	uploadResponse := httptest.NewRecorder()
	(LocalFSHandler{}).Upload(uploadResponse, upload)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", uploadResponse.Code, uploadResponse.Body.String())
	}

	download := httptest.NewRequest(http.MethodGet, "/api/local-files/download?path="+target, nil)
	downloadResponse := httptest.NewRecorder()
	(LocalFSHandler{}).Download(downloadResponse, download)
	if downloadResponse.Code != http.StatusOK || !bytes.Equal(downloadResponse.Body.Bytes(), payload) {
		t.Fatalf("download mismatch: %d bytes=%d", downloadResponse.Code, downloadResponse.Body.Len())
	}
}

func TestTransferLocalToLocalStructuredResult(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.txt")
	destination := filepath.Join(t.TempDir(), "destination.txt")
	if err := os.WriteFile(source, []byte("transfer"), 0644); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(fileTransferRequest{Source: fileEndpoint{Kind: "local", Path: source}, Destination: fileEndpoint{Kind: "local", Path: destination}, RequestID: "req-1"})
	request := httptest.NewRequest(http.MethodPost, "/api/files/transfer", bytes.NewReader(body))
	response := httptest.NewRecorder()
	(&SftpHandler{}).Transfer(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("transfer: %d %s", response.Code, response.Body.String())
	}
	var result struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"request_id"`
		Succeeded []string               `json:"succeeded"`
		Failed    []fileOperationFailure `json:"failed"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Type != "operation_done" || result.RequestID != "req-1" || len(result.Succeeded) != 1 || len(result.Failed) != 0 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if data, err := os.ReadFile(destination); err != nil || string(data) != "transfer" {
		t.Fatalf("destination mismatch: %q %v", data, err)
	}
}

func TestTransferLocalMoveUsesDestinationAndRemovesSource(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.txt")
	destination := filepath.Join(t.TempDir(), "moved.txt")
	if err := os.WriteFile(source, []byte("move"), 0644); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(fileTransferRequest{Source: fileEndpoint{Kind: "local", Path: source}, Destination: fileEndpoint{Kind: "local", Path: destination}, Move: true})
	response := httptest.NewRecorder()
	(&SftpHandler{}).Transfer(response, httptest.NewRequest(http.MethodPost, "/api/files/transfer", bytes.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("move: %d %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source remains: %v", err)
	}
	if data, err := os.ReadFile(destination); err != nil || string(data) != "move" {
		t.Fatalf("destination mismatch: %q %v", data, err)
	}
}

func TestTransferRejectsExistingDestination(t *testing.T) {
	sourceDir := t.TempDir()
	destinationDir := t.TempDir()
	source := filepath.Join(sourceDir, "same.txt")
	target := filepath.Join(destinationDir, "same.txt")
	if err := os.WriteFile(source, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("existing"), 0644); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(fileTransferRequest{Source: fileEndpoint{Kind: "local", Path: source}, Destination: fileEndpoint{Kind: "local", Path: target}})
	response := httptest.NewRecorder()
	(&SftpHandler{}).Transfer(response, httptest.NewRequest(http.MethodPost, "/api/files/transfer", bytes.NewReader(body)))
	var result struct {
		Failed []fileOperationFailure `json:"failed"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Failed) != 1 || !strings.Contains(result.Failed[0].Error, "already exists") {
		t.Fatalf("unexpected result: %s", response.Body.String())
	}
	if data, _ := os.ReadFile(target); string(data) != "existing" {
		t.Fatalf("existing target overwritten: %q", data)
	}
}

func TestTransferProtectsLocalRoot(t *testing.T) {
	root := string(os.PathSeparator)
	if runtime.GOOS == "windows" {
		root = filepath.VolumeName(os.TempDir()) + string(os.PathSeparator)
	}
	body, _ := json.Marshal(fileTransferRequest{Source: fileEndpoint{Kind: "local", Path: root}, Destination: fileEndpoint{Kind: "local", Path: t.TempDir()}})
	response := httptest.NewRecorder()
	(&SftpHandler{}).Transfer(response, httptest.NewRequest(http.MethodPost, "/api/files/transfer", bytes.NewReader(body)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("root transfer status=%d", response.Code)
	}
}
