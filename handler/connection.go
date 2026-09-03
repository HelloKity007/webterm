package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/crypto"
	"github.com/xufanchn/webterm/sshmgr"
	"github.com/xufanchn/webterm/store"
)

func canUseConnection(user *auth.Claims, c *store.Connection) bool {
	return user != nil && (user.Role == "admin" || c.CreatedBy == user.UserID || c.Shared)
}

func canManageConnection(user *auth.Claims, c *store.Connection) bool {
	return user != nil && (user.Role == "admin" || c.CreatedBy == user.UserID)
}

type ConnectionHandler struct {
	Store     *store.Store
	Pool      *sshmgr.Pool
	AESCipher *crypto.AESCipher
}

func (h *ConnectionHandler) List(w http.ResponseWriter, r *http.Request) {
	groupID, _ := strconv.ParseInt(r.URL.Query().Get("group_id"), 10, 64)
	user := auth.GetUser(r)
	conns, err := h.Store.ListConnections(groupID, user.UserID)
	if err != nil {
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	if conns == nil {
		conns = []store.Connection{}
	}
	for i := range conns {
		if conns[i].CreatedBy == user.UserID || user.Role == "admin" {
			if conns[i].PasswordEncrypted != "" {
				pwd, err := h.AESCipher.Decrypt(conns[i].PasswordEncrypted)
				if err == nil {
					conns[i].Password = pwd
				}
			}
		}
	}
	json.NewEncoder(w).Encode(conns)
}

func (h *ConnectionHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r)
	var req struct {
		GroupID    int64  `json:"group_id"`
		Name       string `json:"name"`
		Host       string `json:"host"`
		Port       int    `json:"port"`
		Username   string `json:"username"`
		AuthMethod string `json:"auth_method"`
		Password   string `json:"password"`
		PrivateKey string `json:"private_key"`
		Passphrase string `json:"passphrase"`
		Shared     bool   `json:"shared"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}

	var pwdEnc, keyEnc, passEnc string
	var err error
	if req.Password != "" {
		pwdEnc, err = h.AESCipher.Encrypt(req.Password)
		if err != nil {
			http.Error(w, `{"error":"encryption failed"}`, http.StatusInternalServerError)
			return
		}
	}
	if req.PrivateKey != "" {
		keyEnc, err = h.AESCipher.Encrypt(req.PrivateKey)
		if err != nil {
			http.Error(w, `{"error":"encryption failed"}`, http.StatusInternalServerError)
			return
		}
	}
	if req.Passphrase != "" {
		passEnc, err = h.AESCipher.Encrypt(req.Passphrase)
		if err != nil {
			http.Error(w, `{"error":"encryption failed"}`, http.StatusInternalServerError)
			return
		}
	}

	c := &store.Connection{
		GroupID:                       req.GroupID,
		Name:                          req.Name,
		Host:                          req.Host,
		Port:                          req.Port,
		Username:                      req.Username,
		AuthMethod:                    req.AuthMethod,
		PasswordEncrypted:             pwdEnc,
		PrivateKeyEncrypted:           keyEnc,
		PrivateKeyPassphraseEncrypted: passEnc,
		CreatedBy:                     user.UserID,
		Shared:                        req.Shared,
	}
	id, err := h.Store.CreateConnection(c)
	if err != nil {
		http.Error(w, `{"error":"create failed"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]int64{"id": id})
}

func (h *ConnectionHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	user := auth.GetUser(r)
	var req struct {
		GroupID    int64  `json:"group_id"`
		Name       string `json:"name"`
		Host       string `json:"host"`
		Port       int    `json:"port"`
		Username   string `json:"username"`
		AuthMethod string `json:"auth_method"`
		Password   string `json:"password"`
		PrivateKey string `json:"private_key"`
		Passphrase string `json:"passphrase"`
		Shared     bool   `json:"shared"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}

	var pwdEnc, keyEnc, passEnc string
	var err error
	if req.Password != "" {
		pwdEnc, err = h.AESCipher.Encrypt(req.Password)
		if err != nil {
			http.Error(w, `{"error":"encryption failed"}`, http.StatusInternalServerError)
			return
		}
	}
	if req.PrivateKey != "" {
		keyEnc, err = h.AESCipher.Encrypt(req.PrivateKey)
		if err != nil {
			http.Error(w, `{"error":"encryption failed"}`, http.StatusInternalServerError)
			return
		}
	}
	if req.Passphrase != "" {
		passEnc, err = h.AESCipher.Encrypt(req.Passphrase)
		if err != nil {
			http.Error(w, `{"error":"encryption failed"}`, http.StatusInternalServerError)
			return
		}
	}

	c := &store.Connection{
		ID:                            id,
		GroupID:                       req.GroupID,
		Name:                          req.Name,
		Host:                          req.Host,
		Port:                          req.Port,
		Username:                      req.Username,
		AuthMethod:                    req.AuthMethod,
		PasswordEncrypted:             pwdEnc,
		PrivateKeyEncrypted:           keyEnc,
		PrivateKeyPassphraseEncrypted: passEnc,
		Shared:                        req.Shared,
	}
	// Merge with existing: keep old values for fields not provided
	existing, err := h.Store.GetConnection(id)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if req.Name == "" {
		c.Name = existing.Name
	}
	if req.Host == "" {
		c.Host = existing.Host
	}
	if req.Port == 0 {
		c.Port = existing.Port
	}
	if req.Username == "" {
		c.Username = existing.Username
	}
	if req.AuthMethod == "" {
		c.AuthMethod = existing.AuthMethod
	}
	if pwdEnc == "" {
		c.PasswordEncrypted = existing.PasswordEncrypted
	}
	if keyEnc == "" {
		c.PrivateKeyEncrypted = existing.PrivateKeyEncrypted
	}
	if passEnc == "" {
		c.PrivateKeyPassphraseEncrypted = existing.PrivateKeyPassphraseEncrypted
	}
	if req.GroupID == 0 {
		c.GroupID = existing.GroupID
	}
	c.Shared = req.Shared || existing.Shared
	if !canManageConnection(user, existing) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	if existing.SystemManaged {
		http.Error(w, `{"error":"managed connection cannot be edited"}`, http.StatusForbidden)
		return
	}
	if err := h.Store.UpdateConnection(c); err != nil {
		http.Error(w, `{"error":"update failed"}`, http.StatusInternalServerError)
		return
	}
	// Invalidate cached SSH client so next connection uses updated credentials
	if h.Pool != nil {
		h.Pool.Remove(id)
	}
	w.Write([]byte(`{"status":"ok"}`))
}

func (h *ConnectionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	user := auth.GetUser(r)
	existing, err := h.Store.GetConnection(id)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if !canManageConnection(user, existing) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	if existing.SystemManaged {
		http.Error(w, `{"error":"managed connection cannot be deleted"}`, http.StatusForbidden)
		return
	}
	if err := h.Store.DeleteConnection(id); err != nil {
		http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
		return
	}
	w.Write([]byte(`{"status":"ok"}`))
}
