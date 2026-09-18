//go:build ignore

package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"time"

	"golang.org/x/crypto/ssh"
)

func main() {
	if len(os.Args) != 3 {
		panic("usage: raw-ssh absolute-sz-path owned-payload-path")
	}
	for _, p := range os.Args[1:] {
		if !filepath.IsAbs(p) {
			panic("absolute paths required")
		}
	}
	u, err := user.Current()
	if err != nil {
		panic(err)
	}
	pub, err := os.ReadFile("/etc/ssh/ssh_host_ed25519_key.pub")
	if err != nil {
		panic(err)
	}
	key, _, _, _, err := ssh.ParseAuthorizedKey(pub)
	if err != nil {
		panic(err)
	}
	password := os.Getenv("WEBTERM_LOCAL_SSH_PASSWORD")
	if password == "" {
		panic("missing secret environment")
	}
	c, err := ssh.Dial("tcp", "127.0.0.1:22", &ssh.ClientConfig{User: u.Username, Auth: []ssh.AuthMethod{ssh.Password(password)}, HostKeyCallback: ssh.FixedHostKey(key), HostKeyAlgorithms: []string{ssh.KeyAlgoED25519}, Timeout: 10 * time.Second})
	if err != nil {
		panic(err)
	}
	defer c.Close()
	s, err := c.NewSession()
	if err != nil {
		panic(err)
	}
	defer s.Close()
	if err = s.RequestPty("xterm-256color", 24, 80, ssh.TerminalModes{ssh.ECHO: 0}); err != nil {
		panic(err)
	}
	var out bytes.Buffer
	s.Stdout = &out
	s.Stderr = &out
	err = s.Run(fmt.Sprintf("timeout 3s %q -b %q", os.Args[1], os.Args[2]))
	data := out.Bytes()
	start := bytes.Index(data, []byte{'*', '*', 0x18, 'B'})
	if start < 0 {
		panic("raw SSH PTY did not contain expected ZMODEM header")
	}
	end := start + 24
	if end > len(data) {
		end = len(data)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"scope": "raw SSH PTY diagnostic only, not product browser acceptance", "handshake_hex": hex.EncodeToString(data[start:end]), "contains_zdle": true, "command_exit": fmt.Sprint(err), "bytes_received": len(data)})
}
