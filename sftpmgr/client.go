package sftpmgr

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type Client struct {
	conn   *sftp.Client
	sshCli *ssh.Client
}

func NewClient(sshClient *ssh.Client) (*Client, error) {
	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return nil, err
	}
	return &Client{conn: sftpClient, sshCli: sshClient}, nil
}

type FileInfo struct {
	Name    string      `json:"name"`
	Path    string      `json:"path"`
	Size    int64       `json:"size"`
	Mode    os.FileMode `json:"mode"`
	ModTime string      `json:"mod_time"`
	IsDir   bool        `json:"is_dir"`
	IsLink  bool        `json:"is_link"`
	LinkTo  string      `json:"link_to,omitempty"`
}

func (c *Client) ListDir(path string) ([]FileInfo, error) {
	if path == "" {
		path = "."
	}
	files, err := c.conn.ReadDir(path)
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir() != files[j].IsDir() {
			return files[i].IsDir()
		}
		return files[i].Name() < files[j].Name()
	})
	var result []FileInfo
	for _, f := range files {
		info := FileInfo{
			Name:    f.Name(),
			Path:    filepath.Join(path, f.Name()),
			Size:    f.Size(),
			Mode:    f.Mode(),
			ModTime: f.ModTime().Format("2006-01-02 15:04:05"),
			IsDir:   f.IsDir(),
		}
		if f.Mode()&os.ModeSymlink != 0 {
			info.IsLink = true
			if link, err := c.conn.ReadLink(info.Path); err == nil {
				info.LinkTo = link
			}
		}
		result = append(result, info)
	}
	return result, nil
}

func (c *Client) ReadFile(path string) ([]byte, error) {
	f, err := c.conn.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

// Open opens a remote file for streaming reads. The caller must close it.
func (c *Client) Open(path string) (*sftp.File, error) {
	return c.conn.Open(path)
}

func (c *Client) Stat(path string) (os.FileInfo, error) {
	return c.conn.Stat(path)
}

func (c *Client) Lstat(path string) (os.FileInfo, error) { return c.conn.Lstat(path) }

func (c *Client) ReadDir(path string) ([]os.FileInfo, error) { return c.conn.ReadDir(path) }

func (c *Client) MkdirAll(path string) error { return c.conn.MkdirAll(path) }

func (c *Client) WriteFile(path string, content []byte) error {
	f, err := c.conn.Create(path)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(content)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

func (c *Client) WriteFileFromReader(path string, reader io.Reader) error {
	f, err := c.conn.Create(path)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(f, reader)
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func (c *Client) Delete(path string) error {
	return c.RemoveAll(path)
}

// RemoveAll removes a file, symlink, or directory tree without following
// symlinks. Remote filesystem roots are deliberately protected.
func (c *Client) RemoveAll(name string) error {
	clean := path.Clean(name)
	if clean == "." || clean == "/" {
		return errors.New("refusing to remove remote filesystem root")
	}
	info, err := c.conn.Lstat(clean)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return c.conn.Remove(clean)
	}
	entries, err := c.conn.ReadDir(clean)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := c.RemoveAll(path.Join(clean, entry.Name())); err != nil {
			return err
		}
	}
	return c.conn.RemoveDirectory(clean)
}

// CopyFile streams a regular file on the remote server without buffering it.
func (c *Client) CopyFile(source, destination string) error {
	src, err := c.conn.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("source is not a regular file")
	}
	dst, err := c.conn.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return c.conn.Chmod(destination, info.Mode().Perm())
}

func (c *Client) Copy(source, destination string) error {
	sourceAbs, err := c.absolutePath(source)
	if err != nil {
		return err
	}
	destinationAbs, err := c.absolutePath(destination)
	if err != nil {
		return err
	}
	if sourceAbs == destinationAbs {
		return errors.New("source and destination are the same")
	}
	if _, err := c.conn.Lstat(destinationAbs); err == nil {
		return errors.New("destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	info, err := c.conn.Lstat(sourceAbs)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("copying symbolic links is not supported")
	}
	if sourceAbs == "/" {
		return errors.New("refusing to copy remote filesystem root")
	}
	if info.IsDir() && pathWithin(sourceAbs, destinationAbs) {
		return errors.New("destination cannot be inside source directory")
	}
	if err := c.copyAll(sourceAbs, destinationAbs, info); err != nil {
		cleanupErr := c.RemoveAll(destinationAbs)
		if cleanupErr != nil && !os.IsNotExist(cleanupErr) {
			return errors.Join(err, fmt.Errorf("cleanup partial destination: %w", cleanupErr))
		}
		return err
	}
	return nil
}

func (c *Client) copyAll(source, destination string, info os.FileInfo) error {
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("copying symbolic links is not supported")
	}
	if !info.IsDir() {
		return c.CopyFile(source, destination)
	}
	if err := c.conn.MkdirAll(destination); err != nil {
		return err
	}
	entries, err := c.conn.ReadDir(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := c.copyAll(path.Join(source, entry.Name()), path.Join(destination, entry.Name()), entry); err != nil {
			return err
		}
	}
	return c.conn.Chmod(destination, info.Mode().Perm())
}

func (c *Client) Move(source, destination string) error {
	sourceAbs, err := c.absolutePath(source)
	if err != nil {
		return err
	}
	destinationAbs, err := c.absolutePath(destination)
	if err != nil {
		return err
	}
	if sourceAbs == destinationAbs {
		return errors.New("source and destination are the same")
	}
	if _, err := c.conn.Lstat(destinationAbs); err == nil {
		return errors.New("destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	info, err := c.conn.Lstat(sourceAbs)
	if err != nil {
		return err
	}
	if sourceAbs == "/" {
		return errors.New("refusing to move remote filesystem root")
	}
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 && pathWithin(sourceAbs, destinationAbs) {
		return errors.New("destination cannot be inside source directory")
	}
	return c.conn.Rename(sourceAbs, destinationAbs)
}

func (c *Client) absolutePath(name string) (string, error) {
	clean := path.Clean(name)
	if path.IsAbs(clean) {
		return clean, nil
	}
	wd, err := c.conn.Getwd()
	if err != nil {
		return "", err
	}
	return path.Join(wd, clean), nil
}

func pathWithin(parent, candidate string) bool {
	parent = path.Clean(parent)
	candidate = path.Clean(candidate)
	return candidate == parent || strings.HasPrefix(candidate, parent+"/")
}

func (c *Client) Rename(oldPath, newPath string) error {
	return c.conn.Rename(oldPath, newPath)
}

func (c *Client) Mkdir(path string) error {
	return c.conn.Mkdir(path)
}

func (c *Client) Chmod(path string, mode fs.FileMode) error {
	return c.conn.Chmod(path, mode)
}

func (c *Client) Getwd() (string, error) {
	return c.conn.Getwd()
}

func (c *Client) Close() error {
	return c.conn.Close()
}
