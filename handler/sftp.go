package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/crypto"
	"github.com/xufanchn/webterm/sftpmgr"
	"github.com/xufanchn/webterm/sshmgr"
	"github.com/xufanchn/webterm/store"
)

func friendlyErr(err error) string {
	msg := err.Error()
	if strings.Contains(msg, "unable to authenticate") {
		return "认证失败，请检查用户名和密码"
	}
	if strings.Contains(msg, "connection refused") {
		return "连接被拒绝，请检查主机地址和端口"
	}
	if strings.Contains(msg, "no route to host") {
		return "无法访问主机，请检查网络"
	}
	if strings.Contains(msg, "timeout") {
		return "连接超时，请检查主机可达性"
	}
	if strings.Contains(msg, "knownhosts") || strings.Contains(msg, "host key") {
		return "SSH 主机密钥未受信任或已变更，请联系管理员更新受信任主机密钥"
	}
	if strings.Contains(msg, "handshake failed") {
		return "SSH 握手失败，请检查主机配置"
	}
	return msg
}

type SftpHandler struct {
	Store     *store.Store
	Pool      *sshmgr.Pool
	AESCipher *crypto.AESCipher
}

func (h *SftpHandler) makeSSHFactory(connInfo *store.Connection) func() (*sshmgr.Client, error) {
	return func() (*sshmgr.Client, error) {
		var password, privateKey, passphrase string
		if connInfo.PasswordEncrypted != "" {
			password, _ = h.AESCipher.Decrypt(connInfo.PasswordEncrypted)
		}
		if connInfo.PrivateKeyEncrypted != "" {
			privateKey, _ = h.AESCipher.Decrypt(connInfo.PrivateKeyEncrypted)
		}
		if connInfo.PrivateKeyPassphraseEncrypted != "" {
			passphrase, _ = h.AESCipher.Decrypt(connInfo.PrivateKeyPassphraseEncrypted)
		}
		client, err := sshmgr.NewClient(connInfo.Host, connInfo.Port, connInfo.Username, password, privateKey, passphrase)
		if err != nil {
			return nil, err
		}
		if err := client.Connect(); err != nil {
			return nil, err
		}
		return client, nil
	}
}

func (h *SftpHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(100 << 20); err != nil { // 100MB max
		http.Error(w, `{"error":"file too large"}`, http.StatusBadRequest)
		return
	}

	connID, _ := strconv.ParseInt(r.FormValue("conn_id"), 10, 64)
	path := r.FormValue("path")

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"error":"no file provided"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	connInfo, err := h.Store.GetConnection(connID)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if !canUseConnection(auth.GetUser(r), connInfo) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	sshClient, err := h.Pool.AcquireOrCreate(connID, h.makeSSHFactory(connInfo))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, friendlyErr(err)), http.StatusInternalServerError)
		return
	}
	defer h.Pool.Release(connID)

	sftpClient, err := sftpmgr.NewClient(sshClient.RawConn())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"sftp init: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer sftpClient.Close()

	if err := sftpClient.WriteFileFromReader(path, file); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"upload: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "path": path})
}

func (h *SftpHandler) Download(w http.ResponseWriter, r *http.Request) {
	connID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, `{"error":"path required"}`, http.StatusBadRequest)
		return
	}

	connInfo, err := h.Store.GetConnection(connID)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if !canUseConnection(auth.GetUser(r), connInfo) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	sshClient, err := h.Pool.AcquireOrCreate(connID, h.makeSSHFactory(connInfo))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, friendlyErr(err)), http.StatusInternalServerError)
		return
	}
	defer h.Pool.Release(connID)

	sftpClient, err := sftpmgr.NewClient(sshClient.RawConn())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"sftp init: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer sftpClient.Close()

	data, err := sftpClient.ReadFile(path)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"read: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	fileName := path
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		fileName = path[idx+1:]
	}
	// Escape quotes and backslashes in filename for Content-Disposition header
	escapedName := strings.ReplaceAll(fileName, `\`, `\\`)
	escapedName = strings.ReplaceAll(escapedName, `"`, `\"`)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, escapedName))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Write(data)
}
