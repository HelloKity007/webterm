package handler

import (
	"errors"
	"testing"
)

func TestFriendlyErrExplainsUntrustedSSHHostKey(t *testing.T) {
	got := friendlyErr(errors.New("ssh: handshake failed: knownhosts: key mismatch"))
	if got != "SSH 主机密钥未受信任或已变更，请联系管理员更新受信任主机密钥" {
		t.Fatalf("friendlyErr() = %q", got)
	}
}
