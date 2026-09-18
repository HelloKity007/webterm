package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
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

type fileEndpoint struct {
	Kind   string `json:"kind"`
	ConnID int64  `json:"conn_id,omitempty"`
	Path   string `json:"path"`
}

type fileTransferRequest struct {
	Source      fileEndpoint `json:"source"`
	Destination fileEndpoint `json:"destination"`
	Move        bool         `json:"move"`
	RequestID   string       `json:"request_id"`
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
	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, `{"error":"invalid multipart request"}`, http.StatusBadRequest)
		return
	}
	tmp, err := os.CreateTemp("", "webterm-sftp-upload-*")
	if err != nil {
		http.Error(w, `{"error":"cannot stage upload"}`, http.StatusInternalServerError)
		return
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	defer tmp.Close()

	fields, foundFile, err := stageMultipartUpload(reader, tmp)
	if err != nil {
		http.Error(w, `{"error":"invalid upload"}`, http.StatusBadRequest)
		return
	}
	if !foundFile {
		http.Error(w, `{"error":"no file provided"}`, http.StatusBadRequest)
		return
	}
	connID, err := strconv.ParseInt(fields["conn_id"], 10, 64)
	if err != nil || connID <= 0 || fields["path"] == "" {
		http.Error(w, `{"error":"conn_id and path required"}`, http.StatusBadRequest)
		return
	}
	remotePath := fields["path"]
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		http.Error(w, `{"error":"cannot read staged upload"}`, http.StatusInternalServerError)
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

	if err := sftpClient.UploadAtomic(r.Context(), remotePath, tmp); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"upload: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "path": remotePath})
}

func stageMultipartUpload(reader *multipart.Reader, destination io.Writer) (map[string]string, bool, error) {
	fields := make(map[string]string)
	foundFile := false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return fields, foundFile, nil
		}
		if err != nil {
			return nil, false, err
		}
		name := part.FormName()
		if name == "file" {
			if foundFile {
				part.Close()
				return nil, false, fmt.Errorf("multiple file parts are not supported")
			}
			_, err = io.Copy(destination, part)
			foundFile = err == nil
		} else if name == "conn_id" || name == "path" {
			var data []byte
			data, err = io.ReadAll(io.LimitReader(part, 16<<10))
			if err == nil {
				fields[name] = string(data)
			}
		}
		part.Close()
		if err != nil {
			return nil, false, err
		}
	}
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

	file, err := sftpClient.Open(path)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"read: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, `{"error":"not a regular file"}`, http.StatusBadRequest)
		return
	}

	fileName := pathpkgBase(path)
	w.Header().Set("Content-Disposition", contentDisposition(fileName))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, file)
}

func pathpkgBase(name string) string { return path.Base(strings.ReplaceAll(name, `\`, "/")) }

func contentDisposition(name string) string {
	fallback := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' || r == ';' {
			return '_'
		}
		return r
	}, name)
	if fallback == "" || fallback == "." || fallback == "/" {
		fallback = "download"
	}
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fallback, url.PathEscape(name))
}

// Transfer copies a local or SFTP tree to another endpoint using bounded-memory
// streams. Symbolic links are rejected rather than followed.
func (h *SftpHandler) Transfer(w http.ResponseWriter, r *http.Request) {
	var request fileTransferRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	if !validFileEndpoint(request.Source) || !validFileEndpoint(request.Destination) {
		http.Error(w, `{"error":"invalid endpoint"}`, http.StatusBadRequest)
		return
	}
	if request.Source.Kind == "local" {
		abs, err := filepath.Abs(request.Source.Path)
		if err != nil || isFilesystemRoot(abs) {
			http.Error(w, `{"error":"filesystem root is protected"}`, http.StatusBadRequest)
			return
		}
	} else if path.Clean(request.Source.Path) == "/" || path.Clean(request.Source.Path) == "." {
		http.Error(w, `{"error":"remote filesystem root is protected"}`, http.StatusBadRequest)
		return
	}
	clients := make(map[int64]*sftpmgr.Client)
	cleanups := make([]func(), 0, 2)
	defer func() {
		for i := len(cleanups) - 1; i >= 0; i-- {
			cleanups[i]()
		}
	}()
	for _, endpoint := range []fileEndpoint{request.Source, request.Destination} {
		if endpoint.Kind != "sftp" || clients[endpoint.ConnID] != nil {
			continue
		}
		client, cleanup, err := h.acquireSFTP(r, endpoint.ConnID)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, friendlyErr(err)), http.StatusForbidden)
			return
		}
		clients[endpoint.ConnID] = client
		cleanups = append(cleanups, cleanup)
	}
	if err := ensureTransferDestinationAbsent(request.Destination, clients); err != nil {
		result := map[string]interface{}{"type": "operation_done", "action": "transfer", "request_id": request.RequestID, "succeeded": []string{}, "failed": []fileOperationFailure{{Path: request.Source.Path, Error: err.Error()}}}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
		return
	}

	directMove := request.Move && request.Source.Kind == request.Destination.Kind && (request.Source.Kind == "local" || request.Source.ConnID == request.Destination.ConnID)
	var err error
	if directMove {
		if request.Source.Kind == "local" {
			err = moveLocal(request.Source.Path, request.Destination.Path)
		} else {
			err = clients[request.Source.ConnID].Move(request.Source.Path, request.Destination.Path)
		}
	} else {
		err = transferTree(request.Source, request.Destination, clients)
		if err != nil {
			err = cleanupTransferFailure(request.Destination, clients, err)
		}
	}
	result := map[string]interface{}{"type": "operation_done", "action": "transfer", "request_id": request.RequestID, "succeeded": []string{}, "failed": []fileOperationFailure{}}
	if err != nil {
		result["failed"] = []fileOperationFailure{{Path: request.Source.Path, Error: err.Error()}}
	} else {
		if request.Move && !directMove {
			if request.Source.Kind == "local" {
				err = removeLocalAll(request.Source.Path)
			} else {
				err = clients[request.Source.ConnID].RemoveAll(request.Source.Path)
			}
		}
		if err != nil {
			result["failed"] = []fileOperationFailure{{Path: request.Source.Path, Error: err.Error()}}
		} else {
			result["succeeded"] = []string{request.Source.Path}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func ensureTransferDestinationAbsent(destination fileEndpoint, clients map[int64]*sftpmgr.Client) error {
	var err error
	if destination.Kind == "local" {
		_, err = os.Lstat(destination.Path)
	} else {
		_, err = clients[destination.ConnID].Lstat(destination.Path)
	}
	if err == nil {
		return errors.New("destination already exists")
	}
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func cleanupTransferFailure(destination fileEndpoint, clients map[int64]*sftpmgr.Client, transferErr error) error {
	var cleanupErr error
	if destination.Kind == "local" {
		cleanupErr = removeLocalAll(destination.Path)
	} else {
		cleanupErr = clients[destination.ConnID].RemoveAll(destination.Path)
	}
	if cleanupErr == nil || os.IsNotExist(cleanupErr) {
		return transferErr
	}
	return errors.Join(transferErr, fmt.Errorf("cleanup partial destination: %w", cleanupErr))
}

func validFileEndpoint(endpoint fileEndpoint) bool {
	return (endpoint.Kind == "local" || endpoint.Kind == "sftp") && endpoint.Path != "" && (endpoint.Kind != "sftp" || endpoint.ConnID > 0)
}

func (h *SftpHandler) acquireSFTP(r *http.Request, connID int64) (*sftpmgr.Client, func(), error) {
	connInfo, err := h.Store.GetConnection(connID)
	if err != nil || !canUseConnection(auth.GetUser(r), connInfo) {
		return nil, nil, errors.New("connection forbidden")
	}
	sshClient, err := h.Pool.AcquireOrCreate(connID, h.makeSSHFactory(connInfo))
	if err != nil {
		return nil, nil, err
	}
	client, err := sftpmgr.NewClient(sshClient.RawConn())
	if err != nil {
		h.Pool.Release(connID)
		return nil, nil, err
	}
	cleanup := func() { client.Close(); h.Pool.Release(connID) }
	return client, cleanup, nil
}

func transferTree(source, destination fileEndpoint, clients map[int64]*sftpmgr.Client) error {
	if source.Kind == "local" && destination.Kind == "local" {
		return copyLocal(source.Path, destination.Path)
	}
	if source.Kind == "sftp" && destination.Kind == "sftp" && source.ConnID == destination.ConnID {
		return clients[source.ConnID].Copy(source.Path, destination.Path)
	}
	if source.Kind == "local" {
		return transferLocalToSFTP(source.Path, destination.Path, clients[destination.ConnID])
	}
	if destination.Kind == "local" {
		return transferSFTPToLocal(clients[source.ConnID], source.Path, destination.Path)
	}
	return transferSFTPToSFTP(clients[source.ConnID], source.Path, clients[destination.ConnID], destination.Path)
}

func transferLocalToSFTP(source, destination string, dst *sftpmgr.Client) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("copying symbolic links is not supported")
	}
	if info.IsDir() {
		if err := dst.MkdirAll(destination); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := transferLocalToSFTP(filepath.Join(source, entry.Name()), path.Join(destination, entry.Name()), dst); err != nil {
				return err
			}
		}
		return dst.Chmod(destination, info.Mode().Perm())
	}
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := dst.WriteFileFromReader(destination, file); err != nil {
		return err
	}
	return dst.Chmod(destination, info.Mode().Perm())
}

func transferSFTPToLocal(src *sftpmgr.Client, source, destination string) error {
	info, err := src.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("copying symbolic links is not supported")
	}
	if info.IsDir() {
		if err := os.MkdirAll(destination, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := src.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := transferSFTPToLocal(src, path.Join(source, entry.Name()), filepath.Join(destination, entry.Name())); err != nil {
				return err
			}
		}
		return os.Chmod(destination, info.Mode().Perm())
	}
	reader, err := src.Open(source)
	if err != nil {
		return err
	}
	defer reader.Close()
	writer, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(writer, reader)
	closeErr := writer.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func transferSFTPToSFTP(src *sftpmgr.Client, source string, dst *sftpmgr.Client, destination string) error {
	info, err := src.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("copying symbolic links is not supported")
	}
	if info.IsDir() {
		if err := dst.MkdirAll(destination); err != nil {
			return err
		}
		entries, err := src.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := transferSFTPToSFTP(src, path.Join(source, entry.Name()), dst, path.Join(destination, entry.Name())); err != nil {
				return err
			}
		}
		return dst.Chmod(destination, info.Mode().Perm())
	}
	reader, err := src.Open(source)
	if err != nil {
		return err
	}
	defer reader.Close()
	if err := dst.WriteFileFromReader(destination, reader); err != nil {
		return err
	}
	return dst.Chmod(destination, info.Mode().Perm())
}
