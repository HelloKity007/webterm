package config

import (
	"encoding/hex"
	"fmt"
	"gopkg.in/yaml.v3"
	"net"
	"os"
	"strconv"
	"strings"
)

type LocalQuickConnectConfig struct {
	Host        string `yaml:"host"`
	Port        int    `yaml:"port"`
	Username    string `yaml:"username"`
	PasswordEnv string `yaml:"password_env"`
	MaxSessions int    `yaml:"max_sessions"`
}

type Config struct {
	// Port is retained only so legacy config files continue to parse. New
	// deployments must use ListenAddr, which is deliberately loopback-only.
	Port              int                     `yaml:"port"`
	ListenAddr        string                  `yaml:"listen_addr"`
	EncryptionKey     string                  `yaml:"encryption_key"`
	EncryptionKeyEnv  string                  `yaml:"encryption_key_env"`
	LogLevel          string                  `yaml:"log_level"`
	SSHHostKeyCheck   bool                    `yaml:"ssh_host_key_check"`
	SSHKnownHosts     string                  `yaml:"ssh_known_hosts"`
	LocalQuickConnect LocalQuickConnectConfig `yaml:"local_quick_connect"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := &Config{Port: 8888, ListenAddr: "127.0.0.1:8888", LogLevel: "info"}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	if cfg.EncryptionKey == "" && cfg.EncryptionKeyEnv != "" {
		cfg.EncryptionKey = os.Getenv(cfg.EncryptionKeyEnv)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) Validate() error {
	if c.ListenAddr == "" {
		c.ListenAddr = "127.0.0.1:8888"
	}
	host, port, err := net.SplitHostPort(c.ListenAddr)
	if err != nil {
		return fmt.Errorf("invalid listen_addr: %w", err)
	}
	if host != "127.0.0.1" {
		return fmt.Errorf("listen_addr must bind 127.0.0.1, got %q", host)
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return fmt.Errorf("listen_addr has invalid port %q", port)
	}

	key, err := hex.DecodeString(c.EncryptionKey)
	if err != nil || len(key) != 32 {
		return fmt.Errorf("encryption_key must be 64 hexadecimal characters")
	}
	if strings.Trim(c.EncryptionKey, "0") == "" {
		return fmt.Errorf("encryption_key must not use the default all-zero value")
	}
	if c.LocalQuickConnect.Host != "127.0.0.1" || c.LocalQuickConnect.Port != 22 || c.LocalQuickConnect.Username == "" || c.LocalQuickConnect.PasswordEnv == "" {
		return fmt.Errorf("local_quick_connect must target 127.0.0.1:22 with username and password_env")
	}
	if c.LocalQuickConnect.MaxSessions == 0 {
		c.LocalQuickConnect.MaxSessions = 30
	}
	if c.LocalQuickConnect.MaxSessions < 1 || c.LocalQuickConnect.MaxSessions > 1000 {
		return fmt.Errorf("local_quick_connect.max_sessions must be between 1 and 1000")
	}
	if c.SSHHostKeyCheck {
		if strings.TrimSpace(c.SSHKnownHosts) == "" {
			return fmt.Errorf("ssh_known_hosts is required when ssh_host_key_check is enabled")
		}
		if info, err := os.Stat(c.SSHKnownHosts); err != nil || info.IsDir() {
			return fmt.Errorf("ssh_known_hosts must point to a readable file")
		}
	}
	return nil
}
