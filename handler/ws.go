package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/crypto"
	"github.com/xufanchn/webterm/dbmgr"
	"github.com/xufanchn/webterm/sftpmgr"
	"github.com/xufanchn/webterm/sshmgr"
	"github.com/xufanchn/webterm/store"
	"golang.org/x/crypto/ssh"
	"golang.org/x/net/websocket"
)

type WSHandler struct {
	Store     *store.Store
	Pool      *sshmgr.Pool
	AESCipher *crypto.AESCipher
	// PreserveTerminalSessions makes a release-test environment safe to use
	// with production tmux names: closing a test tab removes only test layout
	// state and never kills the shared remote session.
	PreserveTerminalSessions bool
	// TmuxSocket isolates release-test from production's tmux server. Empty
	// means the user's default tmux socket (production behavior).
	TmuxSocket string
	// RunTerminalCommand is overridden by handler tests to replace remote SSH I/O.
	RunTerminalCommand func(*store.Connection, string) error
	terminalSessions   persistentSessionRegistry
	terminalHistoryMu  sync.Mutex
	terminalHistory    *terminalHistoryStore
}

const terminalHistoryMaxBytes = 8 * 1024 * 1024

func (h *WSHandler) historyFor(key string) *terminalHistory {
	h.terminalHistoryMu.Lock()
	defer h.terminalHistoryMu.Unlock()
	if h.terminalHistory == nil {
		h.terminalHistory = newTerminalHistoryStore(terminalHistoryMaxBytes)
	}
	return h.terminalHistory.get(key)
}

// scopeTmuxCommand routes every tmux invocation, including invocations inside
// run-shell hooks, through the environment-specific server socket. Commands
// are generated internally and contain only controlled tmux syntax.
func scopeTmuxCommand(command, socket string) string {
	if strings.TrimSpace(socket) == "" {
		return command
	}
	return strings.ReplaceAll(command, "tmux ", "tmux -L "+socket+" ")
}

func applyPanelSessionName(command string, userID, connectionID int64, terminalID, workspaceRaw, panelRaw string) string {
	workspaceIndex, workspaceErr := strconv.ParseInt(workspaceRaw, 10, 64)
	panelNumber, panelErr := strconv.ParseInt(panelRaw, 10, 64)
	if workspaceErr != nil || panelErr != nil || workspaceIndex < 1 || panelNumber < 1 {
		return command
	}
	current, err := persistentTerminalPanelSessionName(userID, workspaceIndex, panelNumber, terminalID)
	if err != nil {
		return command
	}
	legacy, err := persistentTerminalSessionName(userID, connectionID, terminalID)
	if err != nil {
		return command
	}
	if current == legacy {
		return command
	}
	command = strings.ReplaceAll(command, legacy, current)
	migrate := fmt.Sprintf("(tmux has-session -t %s 2>/dev/null || (tmux has-session -t %s 2>/dev/null && tmux rename-session -t %s %s) || true) && ", current, legacy, legacy, current)
	return migrate + command
}

func (h *WSHandler) runTerminalCommand(connection *store.Connection, command string) error {
	if h.RunTerminalCommand != nil {
		return h.RunTerminalCommand(connection, command)
	}
	var password, privateKey, passphrase string
	if connection.PasswordEncrypted != "" {
		password, _ = h.AESCipher.Decrypt(connection.PasswordEncrypted)
	}
	if connection.PrivateKeyEncrypted != "" {
		privateKey, _ = h.AESCipher.Decrypt(connection.PrivateKeyEncrypted)
	}
	if connection.PrivateKeyPassphraseEncrypted != "" {
		passphrase, _ = h.AESCipher.Decrypt(connection.PrivateKeyPassphraseEncrypted)
	}
	client, err := sshmgr.NewClient(connection.Host, connection.Port, connection.Username, password, privateKey, passphrase)
	if err != nil {
		return err
	}
	defer client.Close()
	for attempt := 1; attempt <= 3; attempt++ {
		err = client.Connect()
		if err == nil {
			break
		}
		if attempt < 3 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}
	if err != nil {
		return err
	}
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	return session.Run(command)
}

func (h *WSHandler) CloseTerminalSession(w http.ResponseWriter, r *http.Request) {
	connID, err := strconv.ParseInt(r.PathValue("conn_id"), 10, 64)
	if err != nil || connID < 1 {
		http.Error(w, `{"error":"invalid connection"}`, http.StatusBadRequest)
		return
	}
	user := auth.GetUser(r)
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	connection, err := h.Store.GetConnection(connID)
	if err != nil {
		http.Error(w, `{"error":"connection not found"}`, http.StatusNotFound)
		return
	}
	if !canUseConnection(user, connection) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	terminalID := r.URL.Query().Get("terminal_id")
	command, err := persistentTerminalCloseCommand(user.UserID, connID, terminalID)
	if err != nil {
		http.Error(w, `{"error":"invalid terminal"}`, http.StatusBadRequest)
		return
	}
	if h.PreserveTerminalSessions {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"preserved"}`))
		return
	}
	command = applyPanelSessionName(command, user.UserID, connID, terminalID, r.URL.Query().Get("workspace_index"), r.URL.Query().Get("panel_number"))
	command = scopeTmuxCommand(command, h.TmuxSocket)
	if err := h.runTerminalCommand(connection, command); err != nil {
		http.Error(w, `{"error":"failed to close terminal"}`, http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

type terminalInputSession interface {
	WindowChange(rows, cols int) error
	Close() error
}

// pumpTerminalInput owns the browser-to-SSH direction. Closing the SSH
// session when the browser socket ends is essential: otherwise io.Copy on the
// output side can keep the lease reserved indefinitely after a tab is closed.
type terminalPTYSession interface {
	RequestPty(term string, height, width int, modes ssh.TerminalModes) error
}

func requestDefaultTerminalPTY(session terminalPTYSession, modes ssh.TerminalModes) error {
	// RequestPty takes height before width.
	return session.RequestPty("xterm-256color", 40, 120, modes)
}

func pumpTerminalInput(receive func(*json.RawMessage) error, session terminalInputSession, stdin io.Writer, handleAction func(string) error) {
	defer session.Close()
	for {
		var raw json.RawMessage
		if err := receive(&raw); err != nil {
			return
		}
		var actionMsg struct {
			Action string `json:"action"`
		}
		if err := json.Unmarshal(raw, &actionMsg); err == nil && actionMsg.Action != "" {
			if handleAction != nil {
				if err := handleAction(actionMsg.Action); err != nil {
					log.Printf("terminal action %q failed: %v", actionMsg.Action, err)
				}
			}
			continue
		}
		var resizeMsg struct {
			Cols int `json:"cols"`
			Rows int `json:"rows"`
		}
		if err := json.Unmarshal(raw, &resizeMsg); err == nil && resizeMsg.Cols > 1 && resizeMsg.Rows > 0 {
			if err := session.WindowChange(resizeMsg.Rows, resizeMsg.Cols); err != nil {
				log.Printf("SSH resize failed: %v", err)
			}
			continue
		}
		var dataMsg struct {
			Data string `json:"data"`
			B64  bool   `json:"b64"`
		}
		if err := json.Unmarshal(raw, &dataMsg); err == nil && dataMsg.Data != "" {
			if dataMsg.B64 {
				if bin, derr := base64.StdEncoding.DecodeString(dataMsg.Data); derr == nil {
					_, _ = stdin.Write(bin)
				}
			} else {
				_, _ = io.WriteString(stdin, dataMsg.Data)
			}
		}
	}
}

func (h *WSHandler) HandleSSH(conn *websocket.Conn) {
	connID, _ := strconv.ParseInt(conn.Request().PathValue("conn_id"), 10, 64)
	user := auth.GetUserWS(conn.Request())
	if user == nil {
		sendErr(conn, "unauthorized")
		return
	}

	connInfo, err := h.Store.GetConnection(connID)
	if err != nil {
		sendErr(conn, "connection not found")
		return
	}
	if !canUseConnection(user, connInfo) {
		sendErr(conn, "forbidden")
		return
	}
	terminalID := conn.Request().URL.Query().Get("terminal_id")
	tmuxCommand, err := persistentTerminalCommand(user.UserID, connID, terminalID)
	if err != nil {
		sendErr(conn, err.Error())
		return
	}
	controlMode := conn.Request().URL.Query().Get("control") == "1"
	if controlMode {
		tmuxCommand, err = persistentTerminalControlCommand(user.UserID, connID, terminalID)
		if err != nil {
			sendErr(conn, err.Error())
			return
		}
	}
	clearCommand, err := persistentTerminalClearCommand(user.UserID, connID, terminalID)
	if err != nil {
		sendErr(conn, err.Error())
		return
	}
	workspaceIndex := conn.Request().URL.Query().Get("workspace_index")
	panelNumber := conn.Request().URL.Query().Get("panel_number")
	codexScrollableCommand, err := persistentTerminalCodexScrollableCommand(user.UserID, connID, terminalID)
	if err != nil {
		sendErr(conn, err.Error())
		return
	}
	resumeInputCommand, err := persistentTerminalResumeInputCommand(user.UserID, connID, terminalID)
	if err != nil {
		sendErr(conn, err.Error())
		return
	}
	claudeTranscriptCommand, err := persistentTerminalClaudeTranscriptCommand(user.UserID, connID, terminalID)
	if err != nil {
		sendErr(conn, err.Error())
		return
	}
	followInputCommand, err := persistentTerminalFollowInputCommand(user.UserID, connID, terminalID)
	if err != nil {
		sendErr(conn, err.Error())
		return
	}
	tmuxCommand = applyPanelSessionName(tmuxCommand, user.UserID, connID, terminalID, workspaceIndex, panelNumber)
	clearCommand = applyPanelSessionName(clearCommand, user.UserID, connID, terminalID, workspaceIndex, panelNumber)
	codexScrollableCommand = applyPanelSessionName(codexScrollableCommand, user.UserID, connID, terminalID, workspaceIndex, panelNumber)
	resumeInputCommand = applyPanelSessionName(resumeInputCommand, user.UserID, connID, terminalID, workspaceIndex, panelNumber)
	claudeTranscriptCommand = applyPanelSessionName(claudeTranscriptCommand, user.UserID, connID, terminalID, workspaceIndex, panelNumber)
	followInputCommand = applyPanelSessionName(followInputCommand, user.UserID, connID, terminalID, workspaceIndex, panelNumber)
	tmuxCommand = scopeTmuxCommand(tmuxCommand, h.TmuxSocket)
	clearCommand = scopeTmuxCommand(clearCommand, h.TmuxSocket)
	codexScrollableCommand = scopeTmuxCommand(codexScrollableCommand, h.TmuxSocket)
	resumeInputCommand = scopeTmuxCommand(resumeInputCommand, h.TmuxSocket)
	claudeTranscriptCommand = scopeTmuxCommand(claudeTranscriptCommand, h.TmuxSocket)
	followInputCommand = scopeTmuxCommand(followInputCommand, h.TmuxSocket)

	terminalKey := terminalKeyFor(user.UserID, connID, terminalID)
	releaseTerminal, err := h.terminalSessions.acquire(terminalKey, persistentTerminalSessionLimit)
	if err != nil {
		sendErr(conn, fmt.Sprintf("会话数已达上限(%d)，请关闭一些 panel 后重试", persistentTerminalSessionLimit))
		return
	}
	defer releaseTerminal()
	newSSHClient := func() (*sshmgr.Client, error) {
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
		var connectErr error
		for attempt := 1; attempt <= 3; attempt++ {
			connectErr = client.Connect()
			if connectErr == nil {
				break
			}
			if attempt < 3 {
				time.Sleep(time.Duration(attempt) * time.Second)
			}
		}
		if connectErr != nil {
			return nil, connectErr
		}
		return client, nil
	}
	// The registry limits unique tmux panels. SSH channels are transport
	// resources and must not reject additional browser attachments to one panel.
	lease, err := h.Pool.AcquireSession(connID, 0, sshmgr.MaxChannelsPerTransport, newSSHClient)
	if err != nil {
		if errors.Is(err, sshmgr.ErrMaxSessions) {
			sendErr(conn, "SSH 传输通道暂时不可用，请稍后重试")
		} else {
			sendErr(conn, "连接失败: "+friendlyErr(err))
		}
		return
	}
	defer lease.Release()

	session, err := lease.Client.NewSession()
	if err != nil {
		sendErr(conn, "创建会话失败: "+friendlyErr(err))
		return
	}
	defer session.Close()

	modes := ssh.TerminalModes{
		// This PTY can attach to an already-running shared tmux shell. Keep
		// normal echo enabled and never inject setup commands: doing so would
		// append bytes to another browser's unfinished command line.
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := requestDefaultTerminalPTY(session, modes); err != nil {
		sendErr(conn, "pty failed: "+err.Error())
		return
	}

	stdinPipe, _ := session.StdinPipe()
	stdoutPipe, _ := session.StdoutPipe()
	stderrPipe, _ := session.StderrPipe()

	if err := session.Start(tmuxCommand); err != nil {
		sendErr(conn, "无法启动持久终端（远端必须安装 tmux）: "+friendlyErr(err))
		return
	}
	logID, _ := h.Store.CreateSessionLog(&store.SessionLog{
		UserID: user.UserID, ConnectionID: connID, Type: "ssh",
	})
	defer h.Store.EndSessionLog(logID)
	history := h.historyFor(terminalKey)
	controlTracker := &tmuxControlPaneTracker{}
	var inputWriter io.Writer = stdinPipe
	inputSession := terminalInputSession(session)
	if controlMode {
		inputWriter = &tmuxControlInput{tracker: controlTracker, writer: stdinPipe}
		inputSession = &tmuxControlTerminalSession{base: session, writer: stdinPipe}
	}
	// A quiet, already-running pane may not emit a %output notification when a
	// control client attaches. Seed the browser with a real capture of the
	// current screen so restored Claude/Bash sessions are immediately visible.
	if controlMode {
		captureTarget, _ := persistentTerminalSessionName(user.UserID, connID, terminalID)
		if ws, wsErr := strconv.ParseInt(workspaceIndex, 10, 64); wsErr == nil {
			if pn, pnErr := strconv.ParseInt(panelNumber, 10, 64); pnErr == nil {
				if panelTarget, panelErr := persistentTerminalPanelSessionName(user.UserID, ws, pn, terminalID); panelErr == nil {
					captureTarget = panelTarget
				}
			}
		}
		targetName := captureTarget
		captureCommand := scopeTmuxCommand("tmux capture-pane -p -e -t "+targetName, h.TmuxSocket)
		paneCommand := scopeTmuxCommand("tmux display-message -p -t "+targetName+" '#{pane_id}'", h.TmuxSocket)
		go func() {
			captureClient, captureErr := newSSHClient()
			if captureErr != nil {
				return
			}
			defer captureClient.Close()
			captureSession, captureErr := captureClient.NewSession()
			if captureErr != nil {
				return
			}
			defer captureSession.Close()
			var captured bytes.Buffer
			captureSession.Stdout = &captured
			// Resolve the server-assigned pane id before the first browser keypress.
			// Static capture does not emit a control %output event, so relying only
			// on the live tracker would otherwise reject input for restored panes.
			var paneID bytes.Buffer
			paneSession, paneErr := captureClient.NewSession()
			if paneErr == nil {
				paneSession.Stdout = &paneID
				if paneErr = paneSession.Run(paneCommand); paneErr == nil {
					controlTracker.pane = strings.TrimSpace(paneID.String())
				}
				_ = paneSession.Close()
			}
			if captureErr = captureSession.Run(captureCommand); captureErr == nil && captured.Len() > 0 {
				history.appendBytes(captured.Bytes())
				_, _ = (&wsWriter{conn: conn}).Write(captured.Bytes())
			}
		}()
	}

	go func() {
		pumpTerminalInput(func(raw *json.RawMessage) error {
			return websocket.JSON.Receive(conn, raw)
		}, inputSession, inputWriter, func(action string) error {
			var command string
			switch action {
			case "clear_history":
				command = clearCommand
			case "launch_codex_scrollable":
				command = codexScrollableCommand
			case "resume_terminal_input":
				command = resumeInputCommand
			case "open_claude_transcript":
				command = claudeTranscriptCommand
			case "follow_terminal_input":
				command = followInputCommand
			default:
				return fmt.Errorf("unsupported terminal action: %s", action)
			}
			controlClient, err := newSSHClient()
			if err != nil {
				return err
			}
			defer controlClient.Close()
			controlSession, err := controlClient.NewSession()
			if err != nil {
				return err
			}
			defer controlSession.Close()
			return controlSession.Run(command)
		})
	}()

	// Heartbeat: send ping every 10s
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if err := websocket.JSON.Send(conn, map[string]string{"type": "ping"}); err != nil {
				return
			}
		}
	}()

	if controlMode {
		go pumpTmuxControlOutput(stdoutPipe, "", func(data []byte) error {
			history.appendBytes(data)
			_, err := (&wsWriter{conn: conn}).Write(data)
			return err
		}, func(event tmuxControlEvent) error {
			controlTracker.observe(event)
			return nil
		})
		io.Copy(&recordingWSWriter{wsWriter: wsWriter{conn}, history: history}, stderrPipe)
		return
	}
	go io.Copy(&recordingWSWriter{wsWriter: wsWriter{conn}, history: history}, stdoutPipe)
	io.Copy(&recordingWSWriter{wsWriter: wsWriter{conn}, history: history}, stderrPipe)
}

func (h *WSHandler) HandleDB(conn *websocket.Conn) {
	connID, _ := strconv.ParseInt(conn.Request().PathValue("conn_id"), 10, 64)
	user := auth.GetUserWS(conn.Request())
	if user == nil {
		sendErr(conn, "unauthorized")
		return
	}

	dbInfo, err := h.Store.GetDbConnection(connID)
	if err != nil {
		sendErr(conn, "db connection not found")
		return
	}
	if !canUseDbConnection(user, dbInfo) {
		sendErr(conn, "forbidden")
		return
	}

	password, _ := h.AESCipher.Decrypt(dbInfo.PasswordEncrypted)

	client, err := dbmgr.NewClient(dbInfo.Host, dbInfo.Port, dbInfo.Username, password, dbInfo.DatabaseName)
	if err != nil {
		sendErr(conn, "db connect failed: "+err.Error())
		return
	}
	defer client.Close()

	logID, _ := h.Store.CreateSessionLog(&store.SessionLog{
		UserID: user.UserID, ConnectionID: connID, Type: "db",
	})
	defer h.Store.EndSessionLog(logID)

	var msg struct {
		Action   string `json:"action"`
		Query    string `json:"query"`
		Database string `json:"database"`
		Table    string `json:"table"`
	}
	for {
		if err := websocket.JSON.Receive(conn, &msg); err != nil {
			return
		}
		switch msg.Action {
		case "query":
			result, err := client.Execute(msg.Query)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "query_result", "result": result})
			}
		case "databases":
			dbs, err := client.ListDatabases()
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "database_list", "databases": dbs})
			}
		case "tables":
			tables, err := client.ListTables(msg.Database)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "table_list", "database": msg.Database, "tables": tables})
			}
		case "describe":
			cols, err := client.DescribeTable(msg.Database, msg.Table)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "describe_result", "database": msg.Database, "table": msg.Table, "columns": cols})
			}
		default:
			websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": "unknown action"})
		}
	}
}

type wsWriter struct {
	conn *websocket.Conn
}

type recordingWSWriter struct {
	wsWriter
	history *terminalHistory
}

func (w *recordingWSWriter) Write(p []byte) (int, error) {
	w.history.appendBytes(p)
	return w.wsWriter.Write(p)
}

func (w *wsWriter) Write(p []byte) (int, error) {
	msg := map[string]interface{}{"data": string(p)}
	if !utf8.Valid(p) {
		// Binary data (e.g. ZMODEM) must not be mangled by JSON/UTF-8
		msg["data"] = base64.StdEncoding.EncodeToString(p)
		msg["b64"] = true
	}
	if err := websocket.JSON.Send(w.conn, msg); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (h *WSHandler) HandleSFTP(conn *websocket.Conn) {
	connID, _ := strconv.ParseInt(conn.Request().PathValue("conn_id"), 10, 64)
	user := auth.GetUserWS(conn.Request())
	if user == nil {
		sendErr(conn, "unauthorized")
		return
	}

	connInfo, err := h.Store.GetConnection(connID)
	if err != nil {
		sendErr(conn, "connection not found")
		return
	}
	if !canUseConnection(user, connInfo) {
		sendErr(conn, "forbidden")
		return
	}

	// Get or create SSH client (with retry if existing client is stale)
	var sshClient *sshmgr.Client
	var sftpClient *sftpmgr.Client
	var acquireErr error
	sshClient, ok := h.Pool.Acquire(connID)
	if ok {
		sftpClient, acquireErr = sftpmgr.NewClient(sshClient.RawConn())
		if acquireErr != nil {
			// Existing client is stale — close it, release ref, force new connection
			sshClient.Close()
			h.Pool.Release(connID)
			ok = false
		}
	}
	if !ok {
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

		sshClient, err = sshmgr.NewClient(connInfo.Host, connInfo.Port, connInfo.Username, password, privateKey, passphrase)
		if err != nil {
			sendErr(conn, "SSH 连接失败: "+friendlyErr(err))
			return
		}
		if err := sshClient.Connect(); err != nil {
			sendErr(conn, "SSH 连接失败: "+friendlyErr(err))
			return
		}
		h.Pool.Add(connID, sshClient)

		sftpClient, err = sftpmgr.NewClient(sshClient.RawConn())
		if err != nil {
			sendErr(conn, "SFTP 初始化失败: "+friendlyErr(err))
			return
		}
	}

	defer sftpClient.Close()
	defer h.Pool.Release(connID)

	logID, _ := h.Store.CreateSessionLog(&store.SessionLog{
		UserID: user.UserID, ConnectionID: connID, Type: "sftp",
	})
	defer h.Store.EndSessionLog(logID)

	var msg struct {
		Action  string `json:"action"`
		Path    string `json:"path"`
		NewPath string `json:"new_path"`
		Content string `json:"content"`
		Mode    string `json:"mode"`
	}
	for {
		if err := websocket.JSON.Receive(conn, &msg); err != nil {
			return
		}
		switch msg.Action {
		case "list":
			files, err := sftpClient.ListDir(msg.Path)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "file_list", "path": msg.Path, "files": files})
			}
		case "read":
			data, err := sftpClient.ReadFile(msg.Path)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "file_content", "path": msg.Path, "content": string(data)})
			}
		case "write":
			err := sftpClient.WriteFile(msg.Path, []byte(msg.Content))
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "write_done", "path": msg.Path})
			}
		case "delete":
			err := sftpClient.Delete(msg.Path)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "delete_done", "path": msg.Path})
			}
		case "rename":
			err := sftpClient.Rename(msg.Path, msg.NewPath)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "rename_done", "path": msg.Path, "new_path": msg.NewPath})
			}
		case "mkdir":
			err := sftpClient.Mkdir(msg.Path)
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "mkdir_done", "path": msg.Path})
			}
		case "chmod":
			mode, perr := strconv.ParseUint(msg.Mode, 8, 32)
			if perr != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": "invalid mode: " + msg.Mode})
				continue
			}
			err := sftpClient.Chmod(msg.Path, fs.FileMode(mode))
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "chmod_done", "path": msg.Path})
			}
		case "getwd":
			wd, err := sftpClient.Getwd()
			if err != nil {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				websocket.JSON.Send(conn, map[string]interface{}{"type": "pwd", "path": wd})
			}
		default:
			websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": "unknown action: " + msg.Action})
		}
	}
}

func sendErr(conn *websocket.Conn, msg string) {
	websocket.JSON.Send(conn, map[string]interface{}{"type": "error", "error": msg})
	time.Sleep(500 * time.Millisecond)
}
