package handler

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Foundation only: not wired into ordinary attach until durable registration,
// migration and the browser/input readiness gates are implemented together.
type terminalIdentityAttachSpec struct{ Binary, Socket, Session, Incarnation, Nonce string }

var identitySessionPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var identityIncarnationPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var identityNoncePattern = regexp.MustCompile(`^[0-9a-f]{32,64}$`)
var identityResponseFramePattern = regexp.MustCompile(`^%(begin|end|error) ([0-9]+ [0-9]+ [01])$`)
var identitySessionEventPattern = regexp.MustCompile(`^%session-changed (\$[0-9]+) ([A-Za-z0-9_-]+)$`)

func (s terminalIdentityAttachSpec) readyMarker() string {
	return "WEBTERM_READY:" + s.Incarnation + ":" + s.Nonce
}
func (s terminalIdentityAttachSpec) mismatchMarker() string {
	return "WEBTERM_IDENTITY_MISMATCH:" + s.Nonce
}
func (s terminalIdentityAttachSpec) command() (string, error) {
	if s.Binary == "" || strings.ContainsAny(s.Binary+s.Socket, "\x00\r\n") || !identitySessionPattern.MatchString(s.Session) || !identityIncarnationPattern.MatchString(s.Incarnation) || !identityNoncePattern.MatchString(s.Nonce) {
		return "", errors.New("invalid terminal attach identity")
	}
	// Both checking and attaching execute synchronously within one tmux command
	// queue. -N prevents even attach-session's STARTSERVER flag starting a server.
	condition := fmt.Sprintf("#{&&:#{==:#{session_name},%s},#{==:#{@webterm_incarnation},%s}}", s.Session, s.Incarnation)
	success := "attach-session -t =" + s.Session + " ; display-message -p " + s.readyMarker()
	failure := "display-message -p " + s.mismatchMarker()
	args := []string{s.Binary, "-N"}
	if s.Socket != "" {
		args = append(args, "-L", s.Socket)
	}
	args = append(args, "-C", "if-shell", "-F", "-t", "="+s.Session+":", condition, success, failure)
	for i, arg := range args {
		args[i] = "'" + strings.ReplaceAll(arg, "'", "'\"'\"'") + "'"
	}
	return "exec " + strings.Join(args, " "), nil
}

func terminalAttachNonce() string {
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(entropy[:])
}

// Feed raw scanner lines BEFORE parseTmuxControlLine: that existing parser
// discards unprefixed command response bodies. Never feed decoded pane output.
// Single scanner goroutine owns this state. A caller must serialize or publish
// readiness safely before accepting input on another goroutine.
type terminalIdentityAttachGuard struct {
	spec          terminalIdentityAttachSpec
	frame         string
	body          string
	bodyLines     int
	readyResponse bool
	sessionID     string
	failed        error
}

func newTerminalIdentityAttachGuard(s terminalIdentityAttachSpec) *terminalIdentityAttachGuard {
	return &terminalIdentityAttachGuard{spec: s}
}
func (g *terminalIdentityAttachGuard) fail(message string) (bool, error) {
	g.failed = errors.New(message)
	return false, g.failed
}
func (g *terminalIdentityAttachGuard) observeLine(raw string) (bool, error) {
	if g.failed != nil {
		return false, g.failed
	}
	line := strings.TrimSuffix(raw, "\r")
	if len(line) > 2*1024*1024 {
		return g.fail("terminal control line exceeds limit")
	}
	if match := identityResponseFramePattern.FindStringSubmatch(line); match != nil {
		if match[1] == "begin" {
			if g.frame != "" {
				return g.fail("nested terminal response frame")
			}
			g.frame = match[2]
			g.body = ""
			g.bodyLines = 0
		} else {
			if g.frame == "" || g.frame != match[2] {
				return g.fail("terminal response frame mismatch")
			}
			if match[1] == "error" {
				return g.fail("terminal command failed")
			}
			if g.bodyLines == 1 && g.body == g.spec.mismatchMarker() {
				return g.fail("terminal identity mismatch")
			}
			if strings.HasPrefix(g.body, "WEBTERM_READY:") {
				if g.bodyLines != 1 || g.body != g.spec.readyMarker() {
					return g.fail("invalid terminal readiness marker")
				}
				g.readyResponse = true
			}
			g.frame = ""
			g.body = ""
			g.bodyLines = 0
		}
	} else if strings.HasPrefix(line, "%begin") || strings.HasPrefix(line, "%end") || strings.HasPrefix(line, "%error") {
		return g.fail("malformed terminal response frame")
	} else if match := identitySessionEventPattern.FindStringSubmatch(line); match != nil {
		if match[2] != g.spec.Session || (g.sessionID != "" && g.sessionID != match[1]) {
			return g.fail("unexpected terminal session switch")
		}
		g.sessionID = match[1]
	} else if strings.HasPrefix(line, "%session-changed") || strings.HasPrefix(line, "%exit") {
		return g.fail("terminal attachment ended or changed unexpectedly")
	} else if !strings.HasPrefix(line, "%") && g.frame != "" {
		g.bodyLines++
		if g.bodyLines == 1 {
			g.body = line
		}
	}
	return g.readyResponse && g.sessionID != "", nil
}
