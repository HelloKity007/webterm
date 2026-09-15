package handler

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"golang.org/x/net/websocket"
)

func TestChunkedFileListKeepsLargeDirectoriesBelowOneFrame(t *testing.T) {
	files := make([]int, fileListChunkSize*2+7)
	for i := range files {
		files[i] = i
	}
	serverDone := make(chan error, 1)
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		outbound := newWSOutbound(conn)
		serverDone <- sendChunkedFileList(outbound, "/tmp/large", files)
		outbound.Close()
	}))
	defer server.Close()
	client, err := websocket.Dial("ws"+strings.TrimPrefix(server.URL, "http"), "", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	var total, chunks int
	for {
		var message struct {
			Type  string          `json:"type"`
			Files json.RawMessage `json:"files"`
		}
		if err := websocket.JSON.Receive(client, &message); err != nil {
			t.Fatal(err)
		}
		if message.Type == "file_list_chunk" {
			var chunk []int
			if err := json.Unmarshal(message.Files, &chunk); err != nil {
				t.Fatal(err)
			}
			if len(chunk) > fileListChunkSize {
				t.Fatalf("chunk has %d files, limit %d", len(chunk), fileListChunkSize)
			}
			total += len(chunk)
			chunks++
		}
		if message.Type == "file_list_end" {
			break
		}
	}
	if chunks != 3 || total != len(files) {
		t.Fatalf("chunks=%d total=%d", chunks, total)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func TestWSOutboundSerializesConcurrentSenders(t *testing.T) {
	const senders = 4
	const perSender = 40
	serverDone := make(chan error, 1)
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		outbound := newWSOutbound(conn)
		var wg sync.WaitGroup
		for sender := 0; sender < senders; sender++ {
			wg.Add(1)
			go func(sender int) {
				defer wg.Done()
				for sequence := 0; sequence < perSender; sequence++ {
					if err := outbound.Send(map[string]int{"sender": sender, "sequence": sequence}); err != nil {
						serverDone <- err
						return
					}
				}
			}(sender)
		}
		wg.Wait()
		serverDone <- nil
		outbound.Close()
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client, err := websocket.Dial(wsURL, "", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	seen := make(map[string]bool)
	for len(seen) < senders*perSender {
		var message map[string]int
		if err := websocket.JSON.Receive(client, &message); err != nil {
			t.Fatalf("receive %d/%d: %v", len(seen), senders*perSender, err)
		}
		key := fmt.Sprintf("%d/%d", message["sender"], message["sequence"])
		if seen[key] {
			t.Fatalf("duplicate frame %s", key)
		}
		seen[key] = true
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func TestWSRegistrySendsShutdownBeforeClosing(t *testing.T) {
	registry := NewWSRegistry()
	serverReady := make(chan struct{})
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		outbound := newWSOutbound(conn, registry)
		close(serverReady)
		<-outbound.done
	}))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client, err := websocket.Dial(wsURL, "", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	<-serverReady
	go registry.Shutdown()
	var control map[string]string
	if err := websocket.JSON.Receive(client, &control); err != nil {
		t.Fatal(err)
	}
	if control["type"] != "shutdown" {
		t.Fatalf("shutdown control = %#v", control)
	}
}
