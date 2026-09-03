package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/crypto"
	"github.com/xufanchn/webterm/store"
)

type LocalQuickConnectSettings struct {
	Host        string
	Port        int
	Username    string
	MaxSessions int
}

func EnsureManagedLocalConnection(st *store.Store, cipher *crypto.AESCipher, settings LocalQuickConnectSettings, password string) (int64, error) {
	if password == "" {
		return 0, errors.New("local quick connection password is empty")
	}
	if settings.Host == "" || settings.Port < 1 || settings.Username == "" {
		return 0, errors.New("local quick connection settings are incomplete")
	}
	if settings.MaxSessions == 0 {
		settings.MaxSessions = 10
	}
	admin, err := st.GetUserByUsername("admin")
	if err != nil {
		return 0, fmt.Errorf("default admin is required: %w", err)
	}
	encryptedPassword, err := cipher.Encrypt(password)
	if err != nil {
		return 0, err
	}
	return st.UpsertManagedLocalConnection(&store.Connection{
		Name:              "本机 127.0.0.1",
		Host:              settings.Host,
		Port:              settings.Port,
		Username:          settings.Username,
		AuthMethod:        "password",
		PasswordEncrypted: encryptedPassword,
		CreatedBy:         admin.ID,
		MaxSessions:       settings.MaxSessions,
		SystemManaged:     true,
		Hidden:            true,
	})
}

type QuickConnectHandler struct {
	Store *store.Store
}

func (h *QuickConnectHandler) OpenLocal(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r)
	if user == nil || user.Role != "admin" {
		http.Error(w, `{"error":"admin only"}`, http.StatusForbidden)
		return
	}
	connection, err := h.Store.GetManagedLocalConnection()
	if err != nil {
		http.Error(w, `{"error":"local quick connection unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"connection": map[string]any{"id": connection.ID, "name": connection.Name}})
}
