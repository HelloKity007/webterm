package handler

import (
	"bytes"
	"mime/multipart"
	"strings"
	"testing"
)

func TestStageMultipartUploadSupportsFileBeforeFields(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "large.bin")
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("streamed-content"), 4096)
	if _, err := file.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("conn_id", "42"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("path", "/tmp/large.bin"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	reader := multipart.NewReader(&body, writer.Boundary())
	var staged bytes.Buffer
	fields, found, err := stageMultipartUpload(reader, &staged)
	if err != nil {
		t.Fatal(err)
	}
	if !found || !bytes.Equal(staged.Bytes(), payload) {
		t.Fatal("file payload was not staged intact")
	}
	if fields["conn_id"] != "42" || fields["path"] != "/tmp/large.bin" {
		t.Fatalf("unexpected fields: %#v", fields)
	}
}

func TestContentDispositionSanitizesHeaderAndKeepsUTF8Name(t *testing.T) {
	header := contentDisposition("报告\r\nX-Evil: yes;.txt")
	if strings.ContainsAny(header, "\r\n") {
		t.Fatalf("header injection was not removed: %q", header)
	}
	if !strings.Contains(header, "filename*=UTF-8''") || !strings.Contains(header, "%E6%8A%A5%E5%91%8A") {
		t.Fatalf("UTF-8 filename missing: %q", header)
	}
}
