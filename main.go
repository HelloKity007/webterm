package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/xufanchn/webterm/auth"
	"github.com/xufanchn/webterm/config"
	"github.com/xufanchn/webterm/crypto"
	"github.com/xufanchn/webterm/handler"
	"github.com/xufanchn/webterm/sshmgr"
	"github.com/xufanchn/webterm/store"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/net/websocket"
)

var version = "dev"

//go:embed frontend/dist
var frontendDist embed.FS

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	listenAddr := flag.String("listen-addr", "", "override loopback listen address")
	databasePath := flag.String("database", "webterm.db", "path to SQLite database")
	deploymentEnvironment := flag.String("environment", "production", "deployment environment name")
	testAutoLogin := flag.Bool("test-auto-login", false, "temporarily allow admin auto-login in release-test only")
	preserveTerminalSessions := flag.Bool("preserve-terminal-sessions", false, "do not kill shared tmux sessions when tabs close")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("webterm", version)
		return
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	if *listenAddr != "" {
		cfg.ListenAddr = *listenAddr
		if err := cfg.Validate(); err != nil {
			log.Fatalf("invalid listen address override: %v", err)
		}
	}
	sshmgr.SetStrictHostKeyCheck(cfg.SSHHostKeyCheck)
	sshmgr.SetKnownHostsPath(cfg.SSHKnownHosts)

	st, err := store.New(*databasePath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer st.Close()
	seedAdmin(st)

	aesCipher, err := crypto.New(cfg.EncryptionKey)
	if err != nil {
		log.Fatalf("invalid encryption key: %v", err)
	}
	if _, err := handler.EnsureManagedLocalConnection(st, aesCipher, handler.LocalQuickConnectSettings{
		Host: cfg.LocalQuickConnect.Host, Port: cfg.LocalQuickConnect.Port, Username: cfg.LocalQuickConnect.Username, MaxSessions: cfg.LocalQuickConnect.MaxSessions,
	}, os.Getenv(cfg.LocalQuickConnect.PasswordEnv)); err != nil {
		log.Fatalf("failed to initialize local quick connection: %v", err)
	}
	jwtSecret := make([]byte, 32)
	if _, err := rand.Read(jwtSecret); err != nil {
		log.Fatalf("failed to generate jwt secret: %v", err)
	}
	auth.SetJWTSecret(jwtSecret)

	authH := &handler.AuthHandler{Store: st, Environment: *deploymentEnvironment, TestAutoLogin: *testAutoLogin}
	userH := &handler.UserHandler{Store: st}

	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/auth/login", authH.Login)
	mux.HandleFunc("POST /api/auth/test-session", authH.TestSession)
	mux.HandleFunc("POST /api/auth/logout", authH.Logout)

	mux.Handle("GET /api/users", auth.Middleware(auth.AdminOnly(http.HandlerFunc(userH.List))))
	mux.Handle("POST /api/users", auth.Middleware(auth.AdminOnly(http.HandlerFunc(userH.Create))))
	mux.Handle("PUT /api/users/{id}", auth.Middleware(auth.AdminOnly(http.HandlerFunc(userH.Update))))
	mux.Handle("DELETE /api/users/{id}", auth.Middleware(auth.AdminOnly(http.HandlerFunc(userH.Delete))))

	pool := sshmgr.NewPool()
	connH := &handler.ConnectionHandler{Store: st, Pool: pool, AESCipher: aesCipher}
	quickConnectH := &handler.QuickConnectHandler{Store: st}
	layoutH := &handler.LayoutHandler{Store: st, Hub: handler.NewLayoutHub()}
	wsH := &handler.WSHandler{
		Store: st, Pool: pool, AESCipher: aesCipher,
		PreserveTerminalSessions: *preserveTerminalSessions,
		// Release-test gets a private tmux server. Its copied layout may use the
		// same terminal IDs, but must never resize or mutate production sessions.
		TmuxSocket: func() string {
			if *deploymentEnvironment == "release-test" {
				return "webterm-release-test"
			}
			return ""
		}(),
	}

	mux.Handle("GET /api/connections", auth.Middleware(http.HandlerFunc(connH.List)))
	mux.Handle("GET /api/terminal-history/{conn_id}", auth.Middleware(http.HandlerFunc(wsH.ReplayTerminalHistory)))
	mux.Handle("POST /api/connections", auth.Middleware(http.HandlerFunc(connH.Create)))
	mux.Handle("PUT /api/connections/{id}", auth.Middleware(http.HandlerFunc(connH.Update)))
	mux.Handle("DELETE /api/connections/{id}", auth.Middleware(http.HandlerFunc(connH.Delete)))
	mux.Handle("POST /api/quick-connect/local", auth.Middleware(http.HandlerFunc(quickConnectH.OpenLocal)))
	mux.Handle("GET /api/layout", auth.Middleware(http.HandlerFunc(layoutH.Get)))
	mux.Handle("PUT /api/layout", auth.Middleware(http.HandlerFunc(layoutH.Save)))
	mux.Handle("/ws/layout", websocket.Handler(layoutH.HandleEvents))

	sftpRestH := &handler.SftpHandler{Store: st, Pool: pool, AESCipher: aesCipher}

	mux.Handle("POST /api/sftp/upload", auth.Middleware(http.HandlerFunc(sftpRestH.Upload)))
	mux.Handle("GET /api/sftp/download/{id}", auth.Middleware(http.HandlerFunc(sftpRestH.Download)))

	dbConnH := &handler.DbConnHandler{Store: st, AESCipher: aesCipher}
	groupH := &handler.GroupHandler{Store: st}

	mux.Handle("GET /api/db_connections", auth.Middleware(http.HandlerFunc(dbConnH.List)))
	mux.Handle("POST /api/db_connections", auth.Middleware(http.HandlerFunc(dbConnH.Create)))
	mux.Handle("PUT /api/db_connections/{id}", auth.Middleware(http.HandlerFunc(dbConnH.Update)))
	mux.Handle("DELETE /api/db_connections/{id}", auth.Middleware(http.HandlerFunc(dbConnH.Delete)))

	mux.Handle("GET /api/groups", auth.Middleware(http.HandlerFunc(groupH.List)))
	mux.Handle("POST /api/groups", auth.Middleware(http.HandlerFunc(groupH.Create)))
	mux.Handle("PUT /api/groups/{id}", auth.Middleware(http.HandlerFunc(groupH.Update)))
	mux.Handle("DELETE /api/groups/{id}", auth.Middleware(http.HandlerFunc(groupH.Delete)))

	mux.Handle("/ws/ssh/{conn_id}", websocket.Handler(wsH.HandleSSH))
	mux.Handle("DELETE /api/terminal-sessions/{conn_id}", auth.Middleware(http.HandlerFunc(wsH.CloseTerminalSession)))
	mux.Handle("/ws/sftp/{conn_id}", websocket.Handler(wsH.HandleSFTP))
	mux.Handle("/ws/db/{conn_id}", websocket.Handler(wsH.HandleDB))
	mux.Handle("/ws/local-fs", auth.Middleware(websocket.Handler(handler.HandleLocalFS)))

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":      "ok",
			"environment": *deploymentEnvironment,
			"version":     version,
		})
	})

	mux.HandleFunc("/", spaHandler())

	log.Printf("webterm %s starting on %s (%s, database=%s, preserve_terminal_sessions=%t)", version, cfg.ListenAddr, *deploymentEnvironment, *databasePath, *preserveTerminalSessions)
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func spaHandler() http.HandlerFunc {
	dist, err := fs.Sub(frontendDist, "frontend/dist")
	if err != nil {
		panic("frontend not built, run: cd ui && npm run build")
	}
	fileServer := http.FileServer(http.FS(dist))

	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Skip API and WebSocket paths — they are handled by more specific mux patterns
		if len(path) >= 4 && path[:4] == "/api" {
			return
		}
		if len(path) >= 3 && path[:3] == "/ws" {
			return
		}

		// Try to serve the requested file
		f, err := dist.Open(path[1:]) // strip leading "/"
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html
		indexFile, err := dist.Open("index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}
		defer indexFile.Close()
		stat, _ := indexFile.Stat()
		data, err := io.ReadAll(indexFile)
		if err != nil {
			http.Error(w, "failed to read index.html", http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, "index.html", stat.ModTime(), bytes.NewReader(data))
	}
}

func seedAdmin(st *store.Store) {
	if _, err := st.GetUserByUsername("admin"); err == nil {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("warning: failed to generate admin hash: %v", err)
		return
	}
	if _, err := st.CreateUser("admin", string(hash), "admin"); err != nil {
		log.Printf("warning: failed to seed admin user: %v", err)
	} else {
		log.Println("seeded default admin user (admin/admin)，请立即修改密码")
	}
}
