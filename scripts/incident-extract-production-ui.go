//go:build ignore

// Extract every file from the production binary's Go embed.FS, and verify each
// against the production HTTP endpoint. Only writes a new output directory.
package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func main() {
	if len(os.Args) != 4 {
		panic("usage: go run script.go BINARY NEW_OUTPUT_DIR HTTPS_BASE")
	}
	binary, out, base := os.Args[1], os.Args[2], strings.TrimRight(os.Args[3], "/")
	raw, err := os.ReadFile(binary)
	must(err)
	ef, err := elf.Open(binary)
	must(err)
	defer ef.Close()
	if ef.Class != elf.ELFCLASS64 || ef.Machine != elf.EM_X86_64 {
		panic("only verified amd64 layout supported")
	}
	read := func(addr, n uint64) []byte {
		for _, p := range ef.Progs {
			if p.Type == elf.PT_LOAD && addr >= p.Vaddr && addr-p.Vaddr <= p.Filesz && n <= p.Filesz-(addr-p.Vaddr) {
				off := p.Off + addr - p.Vaddr
				return raw[off : off+n]
			}
		}
		panic(fmt.Sprintf("unmapped address %x length %d", addr, n))
	}
	word := func(addr uint64) uint64 { return ef.ByteOrder.Uint64(read(addr, 8)) }
	syms, err := ef.Symbols()
	must(err)
	var address uint64
	for _, s := range syms {
		if s.Name == "main.frontendDist" {
			address = s.Value
		}
	}
	if address == 0 {
		panic("frontendDist symbol unavailable")
	}
	table := word(address)
	entries, count, cap := word(table), word(table+8), word(table+16)
	if count == 0 || count > 100000 || count != cap {
		panic("invalid embed table")
	}
	type asset struct {
		Path       string `json:"path"`
		Bytes      int    `json:"bytes"`
		SHA256     string `json:"sha256"`
		HTTPStatus int    `json:"httpStatus"`
		HTTPMatch  bool   `json:"httpMatch"`
	}
	var files []asset
	contents := map[string][]byte{}
	client := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	for i := uint64(0); i < count; i++ {
		entry := entries + i*48
		name := string(read(word(entry), word(entry+8)))
		if strings.HasSuffix(name, "/") {
			continue
		}
		if !strings.HasPrefix(name, "frontend/dist/") {
			panic("unexpected embed file: " + name)
		}
		rel := strings.TrimPrefix(name, "frontend/dist/")
		if filepath.Clean(rel) != rel || strings.HasPrefix(rel, "../") || filepath.IsAbs(rel) {
			panic("unsafe path")
		}
		data := read(word(entry+16), word(entry+24))
		digest := sha256.Sum256(data)
		// Go 1.26.6 staticdata.fileStringSym uses cmd/internal/hash: small
		// files XOR the first SHA byte; larger files hash a leading byte 1.
		embeddedDigest := digest
		if len(data) <= 1024 {
			embeddedDigest[0] ^= 0xff
		} else {
			h := sha256.New()
			h.Write([]byte{1})
			h.Write(data)
			copy(embeddedDigest[:], h.Sum(nil))
		}
		if !bytes.Equal(embeddedDigest[:16], read(entry+32, 16)) {
			panic("embedded hash mismatch: " + rel)
		}
		url := base + "/" + rel
		if rel == "index.html" {
			url = base + "/"
		}
		response, err := client.Get(url)
		must(err)
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		must(err)
		equal := response.StatusCode == 200 && bytes.Equal(data, body)
		if !equal {
			panic(fmt.Sprintf("HTTP mismatch %s status %d", url, response.StatusCode))
		}
		files = append(files, asset{rel, len(data), hex.EncodeToString(digest[:]), response.StatusCode, equal})
		contents[rel] = data
	}
	if _, ok := contents["index.html"]; !ok {
		panic("index missing")
	}
	must(os.Mkdir(out, 0700))
	for rel, data := range contents {
		path := filepath.Join(out, rel)
		must(os.MkdirAll(filepath.Dir(path), 0700))
		must(os.WriteFile(path, data, 0600))
	}
	digest := sha256.Sum256(raw)
	report := map[string]any{"binary": binary, "binarySHA256": hex.EncodeToString(digest[:]), "baseURL": base, "embedEntries": count, "fileCount": len(files), "files": files, "verifiedUTC": time.Now().UTC().Format(time.RFC3339), "method": "ELF main.frontendDist pointer -> complete embed file table; every file validates Go 1.26.6 compiler content hash and full HTTP response bytes; manifest records standard SHA256"}
	reportBytes, err := json.MarshalIndent(report, "", "  ")
	must(err)
	must(os.WriteFile(out+".manifest.json", reportBytes, 0600))
	fmt.Printf("PASS: all %d embedded files verified against HTTP; %d total embed entries; binary %x\n", len(files), count, digest)
}
