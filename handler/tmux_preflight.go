package handler

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xufanchn/webterm/sshmgr"
	"github.com/xufanchn/webterm/store"
)

const tmuxPreflightTTL = 5 * time.Minute

var tmuxVersionPattern = regexp.MustCompile(`(?i)^tmux\s+([0-9]+)\.([0-9]+)(?:[a-z][0-9]*)?\s*$`)

type tmuxPreflightError struct {
	Code    string
	Message string
}

func (e *tmuxPreflightError) Error() string { return e.Code + ": " + e.Message }

type tmuxPreflightEntry struct {
	fingerprint string
	expiresAt   time.Time
	err         error
	ready       chan struct{}
}

func parseTmuxVersion(output string) (int, int, error) {
	matches := tmuxVersionPattern.FindStringSubmatch(strings.TrimSpace(output))
	if len(matches) != 3 {
		return 0, 0, &tmuxPreflightError{Code: "TMUX_VERSION_UNKNOWN", Message: "无法识别远端 tmux 版本，请安装稳定版 tmux 3.1 或更高版本"}
	}
	major, majorErr := strconv.Atoi(matches[1])
	minor, minorErr := strconv.Atoi(matches[2])
	if majorErr != nil || minorErr != nil {
		return 0, 0, &tmuxPreflightError{Code: "TMUX_VERSION_UNKNOWN", Message: "无法识别远端 tmux 版本，请安装稳定版 tmux 3.1 或更高版本"}
	}
	return major, minor, nil
}

func checkTmuxVersion(output string, runErr error) error {
	lower := strings.ToLower(output)
	if runErr != nil && (strings.Contains(lower, "not found") || strings.Contains(lower, "no such file")) {
		return &tmuxPreflightError{Code: "TMUX_MISSING", Message: "远端未安装 tmux，请安装 tmux 3.1 或更高版本后重试"}
	}
	if runErr != nil {
		return &tmuxPreflightError{Code: "TMUX_VERSION_UNKNOWN", Message: "无法执行远端 tmux -V，请检查 SSH 权限和 tmux 安装"}
	}
	major, minor, err := parseTmuxVersion(output)
	if err != nil {
		return err
	}
	if major < 3 || (major == 3 && minor < 1) {
		return &tmuxPreflightError{Code: "TMUX_TOO_OLD", Message: "远端 tmux 版本过低，请升级到 tmux 3.1 或更高版本"}
	}
	return nil
}

func tmuxConnectionFingerprint(connection *store.Connection) string {
	return fmt.Sprintf("%d|%s|%d|%s|%s|%s|%s", connection.ID, connection.Host, connection.Port,
		connection.Username, connection.PasswordEncrypted, connection.PrivateKeyEncrypted, connection.PrivateKeyPassphraseEncrypted)
}

func runTmuxVersion(client *sshmgr.Client) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	output, err := session.CombinedOutput("tmux -V")
	return string(output), err
}

func (h *WSHandler) ensureTmuxPreflight(connection *store.Connection, client *sshmgr.Client) error {
	fingerprint := tmuxConnectionFingerprint(connection)
	now := time.Now()

	h.tmuxPreflightMu.Lock()
	if h.tmuxPreflights == nil {
		h.tmuxPreflights = make(map[int64]*tmuxPreflightEntry)
	}
	if cached := h.tmuxPreflights[connection.ID]; cached != nil && cached.fingerprint == fingerprint {
		if cached.ready != nil {
			ready := cached.ready
			h.tmuxPreflightMu.Unlock()
			<-ready
			h.tmuxPreflightMu.Lock()
			cached = h.tmuxPreflights[connection.ID]
		}
		if cached != nil && cached.fingerprint == fingerprint && cached.expiresAt.After(now) {
			err := cached.err
			h.tmuxPreflightMu.Unlock()
			return err
		}
	}
	entry := &tmuxPreflightEntry{fingerprint: fingerprint, ready: make(chan struct{})}
	h.tmuxPreflights[connection.ID] = entry
	h.tmuxPreflightMu.Unlock()

	runner := h.RunTmuxPreflight
	if runner == nil {
		runner = runTmuxVersion
	}
	output, runErr := runner(client)
	result := checkTmuxVersion(output, runErr)
	cacheTTL := tmuxPreflightTTL
	if result != nil {
		cacheTTL = 30 * time.Second
	}

	h.tmuxPreflightMu.Lock()
	entry.err = result
	entry.expiresAt = time.Now().Add(cacheTTL)
	close(entry.ready)
	entry.ready = nil
	h.tmuxPreflightMu.Unlock()
	return result
}
