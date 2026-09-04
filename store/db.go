package store

import (
	"database/sql"
	_ "modernc.org/sqlite"
)

type Store struct {
	DB *sql.DB
}

func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	s := &Store{DB: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'user',
		disabled INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS groups_t (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		parent_id INTEGER DEFAULT 0,
		sort_order INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS connections (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		group_id INTEGER DEFAULT 0,
		name TEXT NOT NULL,
		host TEXT NOT NULL,
		port INTEGER DEFAULT 22,
		username TEXT NOT NULL,
		auth_method TEXT NOT NULL DEFAULT 'password',
		password_encrypted TEXT DEFAULT '',
		private_key_encrypted TEXT DEFAULT '',
		private_key_passphrase_encrypted TEXT DEFAULT '',
		created_by INTEGER DEFAULT 0,
		shared INTEGER DEFAULT 0,
		max_sessions INTEGER DEFAULT 30,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS db_connections (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		group_id INTEGER DEFAULT 0,
		name TEXT NOT NULL,
		host TEXT NOT NULL,
		port INTEGER DEFAULT 3306,
		username TEXT NOT NULL,
		password_encrypted TEXT DEFAULT '',
		database_name TEXT DEFAULT '',
		engine TEXT NOT NULL DEFAULT 'mysql',
		created_by INTEGER DEFAULT 0,
		shared INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS sftp_bookmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		group_id INTEGER DEFAULT 0,
		connection_id INTEGER DEFAULT 0,
		name TEXT NOT NULL,
		remote_path TEXT NOT NULL DEFAULT '/',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS session_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		connection_id INTEGER DEFAULT 0,
		type TEXT NOT NULL DEFAULT 'ssh',
		started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		ended_at DATETIME
	);

	CREATE TABLE IF NOT EXISTS user_layouts (
		user_id INTEGER PRIMARY KEY,
		schema_version INTEGER NOT NULL,
		revision INTEGER NOT NULL,
		layout_json TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	`
	_, err := s.DB.Exec(schema)
	if err != nil {
		return err
	}
	// Migrations: add columns (ignore errors if already exist)
	s.DB.Exec("ALTER TABLE connections ADD COLUMN max_sessions INTEGER DEFAULT 30")
	s.DB.Exec("ALTER TABLE connections ADD COLUMN tag TEXT DEFAULT ''")
	s.DB.Exec("ALTER TABLE connections ADD COLUMN color TEXT DEFAULT '#4fc3f7'")
	s.DB.Exec("ALTER TABLE connections ADD COLUMN system_managed INTEGER NOT NULL DEFAULT 0")
	s.DB.Exec("ALTER TABLE connections ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
	return nil
}

func (s *Store) Close() error {
	return s.DB.Close()
}
