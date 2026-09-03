package sshmgr

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type Client struct {
	conn   *ssh.Client
	config *ssh.ClientConfig
	addr   string
}

var strictHostKeyCheck bool
var knownHostsPath string

// SetStrictHostKeyCheck enables verification of SSH host keys against ~/.ssh/known_hosts.
func SetStrictHostKeyCheck(strict bool) { strictHostKeyCheck = strict }

// SetKnownHostsPath configures the exact trust store used by strict host-key
// verification. An empty value retains the legacy per-user default.
func SetKnownHostsPath(path string) { knownHostsPath = path }

func knownHostsCallback() (ssh.HostKeyCallback, error) {
	path := knownHostsPath
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		path = filepath.Join(home, ".ssh", "known_hosts")
	}
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("ssh_host_key_check enabled but %s not found", path)
	}
	return knownhosts.New(path)
}

func NewClient(host string, port int, username, password, privateKey, passphrase string) (*Client, error) {
	authMethods := []ssh.AuthMethod{}
	if password != "" {
		authMethods = append(authMethods, ssh.Password(password))
	}
	if privateKey != "" {
		var signer ssh.Signer
		var err error
		if passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(privateKey), []byte(passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(privateKey))
		}
		if err != nil {
			return nil, err
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}
	hostKeyCallback := ssh.InsecureIgnoreHostKey()
	if strictHostKeyCheck {
		cb, err := knownHostsCallback()
		if err != nil {
			return nil, err
		}
		hostKeyCallback = cb
	}
	config := &ssh.ClientConfig{
		User:            username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	}
	return &Client{
		config: config,
		addr:   net.JoinHostPort(host, fmt.Sprintf("%d", port)),
	}, nil
}

func (c *Client) Connect() error {
	conn, err := ssh.Dial("tcp", c.addr, c.config)
	if err != nil {
		return err
	}
	c.conn = conn
	return nil
}

func (c *Client) NewSession() (*ssh.Session, error) {
	return c.conn.NewSession()
}

func (c *Client) IsAlive() bool {
	if c.conn == nil {
		return false
	}
	_, _, err := c.conn.SendRequest("keepalive@openssh.com", true, nil)
	return err == nil
}

func (c *Client) RawConn() *ssh.Client {
	return c.conn
}

func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
