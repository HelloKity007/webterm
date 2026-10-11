package handler

import (
	"crypto/sha256"
	"fmt"
	"path"
	"regexp"
	"strings"

	"github.com/xufanchn/webterm/store"
)

// ValidateTerminalIsolation validates remote paths, never creates local paths.
// The separate executable lets existing servers retain their matching client.
func ValidateTerminalIsolation(environment, directory, binary string) error {
	if directory == "" && binary == "" {
		return nil
	}
	safe := regexp.MustCompile(`^/[a-zA-Z0-9_./-]+$`)
	if (environment != "production" && environment != "release-test") ||
		!safe.MatchString(directory) || path.Clean(directory) != directory ||
		!safe.MatchString(binary) || path.Clean(binary) != binary ||
		path.Base(directory) != "webterm-"+environment || len(directory)+34 > 100 {
		return fmt.Errorf("terminal isolation requires paired absolute shell-safe binary and durable directory ending in webterm-%s (socket <=100 bytes)", environment)
	}
	for _, prefix := range []string{"/tmp", "/var/tmp", "/run", "/var/run"} {
		if directory == prefix || strings.HasPrefix(directory, prefix+"/") {
			return fmt.Errorf("terminal isolation directory must not be temporary")
		}
	}
	return nil
}

func (h *WSHandler) isolatedTerminalSocket(userID, connectionID int64, terminalID string) string {
	if h.TmuxSessionDirectory == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(h.terminalEnvironment() + ":" + terminalKeyFor(userID, connectionID, terminalID)))
	return fmt.Sprintf("%s/%x", h.TmuxSessionDirectory, sum[:16])
}

func (h *WSHandler) terminalSocketMatches(instance *store.TerminalInstance) bool {
	return instance.Socket == h.terminalRegistrySocket() ||
		(h.TmuxSessionDirectory != "" && instance.Socket == h.isolatedTerminalSocket(instance.UserID, instance.ConnectionID, instance.TerminalID))
}

func (h *WSHandler) terminalTransport(instance *store.TerminalInstance) (string, string) {
	if h.TmuxSessionDirectory != "" && instance.Socket == h.isolatedTerminalSocket(instance.UserID, instance.ConnectionID, instance.TerminalID) {
		return instance.Socket, h.TmuxSessionBinary
	}
	return h.TmuxSocket, h.TmuxBinary
}

// Only explicit creation may provision a server. Each private server keeps the
// exact pinned executable. A core-enabled wrapper may collect crash artifacts.
func (h *WSHandler) scopeTerminalCreation(command string, instance *store.TerminalInstance) string {
	socket, binary := h.terminalTransport(instance)
	if socket == h.TmuxSocket {
		return scopeTmuxCommand(command, socket, binary)
	}
	// A private server cannot inherit the options previously set on the shared
	// server. Set them BEFORE the first pane is allocated (history-limit is
	// captured at pane creation). Ignore user tmux configuration, which may
	// auto-restore unrelated sessions or terminate an unattached server.
	bootstrap := fmt.Sprintf("tmux -f /dev/null set-option -g history-limit %d \\; set-option -g window-size largest \\; set-option -g status off \\; set-option -g set-titles on \\; set-option -g set-titles-string 'webterm-grid:#{window_width}x#{window_height}' \\; set-option -g mouse on \\; set-option -g @webterm_mouse_passthrough on \\; set-option -g default-terminal screen-256color \\; set-option -s exit-empty on \\; set-option -s exit-unattached off \\; new-session", terminalHistoryLines)
	command = scopeTmuxCommand(strings.Replace(command, "tmux new-session", bootstrap, 1), socket, binary)
	// Directory paths are validated at startup. Core collection must be enabled
	// explicitly by the operator; do not change machine-wide core_pattern here.
	return "umask 077; mkdir -p " + h.TmuxSessionDirectory + " && test ! -L " + h.TmuxSessionDirectory +
		" && test \"$(stat -c %u " + h.TmuxSessionDirectory + ")\" = \"$(id -u)\" && test \"$(stat -c %a " + h.TmuxSessionDirectory + ")\" = 700 && " + command
}
