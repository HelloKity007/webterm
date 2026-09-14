package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/net/websocket"
)

type LocalFileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	Mode    uint32 `json:"mode"`
	ModTime string `json:"mod_time"`
	IsDir   bool   `json:"is_dir"`
	IsLink  bool   `json:"is_link"`
}

// File lists can be much larger than the WebSocket frame budget. Send small
// ordered batches so the browser can render a virtualized directory without a
// single oversized JSON message or a long write deadline.
const fileListChunkSize = 1000

func sendChunkedFileList[T any](outbound *wsOutbound, path string, files []T) error {
	if err := outbound.Send(map[string]interface{}{
		"type": "file_list_start", "path": path, "total": len(files),
	}); err != nil {
		return err
	}
	for start := 0; start < len(files); start += fileListChunkSize {
		end := start + fileListChunkSize
		if end > len(files) {
			end = len(files)
		}
		if err := outbound.Send(map[string]interface{}{
			"type": "file_list_chunk", "path": path, "files": files[start:end],
		}); err != nil {
			return err
		}
	}
	return outbound.Send(map[string]interface{}{"type": "file_list_end", "path": path})
}

func HandleLocalFS(conn *websocket.Conn) {
	handleLocalFS(conn, nil)
}

func HandleLocalFSWithRegistry(registry *WSRegistry) func(*websocket.Conn) {
	return func(conn *websocket.Conn) { handleLocalFS(conn, registry) }
}

func handleLocalFS(conn *websocket.Conn, registry *WSRegistry) {
	conn.MaxPayloadBytes = maxWSInboundPayloadBytes
	outbound := newWSOutbound(conn, registry)
	defer outbound.Close()
	var msg struct {
		Action      string   `json:"action"`
		Path        string   `json:"path"`
		Content     string   `json:"content"`
		NewPath     string   `json:"new_path"`
		Paths       []string `json:"paths"`
		Destination string   `json:"destination"`
		RequestID   string   `json:"request_id"`
	}

	for {
		if err := receiveWebSocketJSON(conn, &msg); err != nil {
			return
		}
		switch msg.Action {
		case "ping":
			_ = outbound.Send(map[string]string{"type": "pong"})
		case "getwd":
			wd, err := os.Getwd()
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				outbound.Send(map[string]interface{}{"type": "pwd", "path": wd})
			}
		case "list":
			path, err := cleanLocalPath(msg.Path)
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
				continue
			}
			if path == "" {
				path = "/"
			}
			entries, err := os.ReadDir(path)
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
				continue
			}
			var files []LocalFileInfo
			for _, e := range entries {
				info, err := e.Info()
				if err != nil {
					continue
				}
				fullPath := filepath.Join(path, e.Name())
				f := LocalFileInfo{
					Name:    e.Name(),
					Path:    fullPath,
					Size:    info.Size(),
					Mode:    uint32(info.Mode()),
					ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
					IsDir:   e.IsDir(),
					IsLink:  info.Mode()&os.ModeSymlink != 0,
				}
				files = append(files, f)
			}
			sort.Slice(files, func(i, j int) bool {
				if files[i].IsDir != files[j].IsDir {
					return files[i].IsDir
				}
				return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
			})
			if err := sendChunkedFileList(outbound, path, files); err != nil {
				return
			}
		case "read":
			cleanPath, err := cleanLocalPath(msg.Path)
			if err == nil {
				var data []byte
				data, err = os.ReadFile(cleanPath)
				if err == nil {
					outbound.Send(map[string]interface{}{"type": "file_content", "path": cleanPath, "content": string(data)})
					continue
				}
			}
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
			}
		case "write":
			cleanPath, err := cleanLocalPath(msg.Path)
			if err == nil {
				err = os.WriteFile(cleanPath, []byte(msg.Content), 0644)
			}
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				outbound.Send(map[string]interface{}{"type": "write_done", "path": msg.Path})
			}
		case "delete":
			cleanPath, err := cleanLocalPath(msg.Path)
			if err == nil {
				err = removeLocalAll(cleanPath)
			}
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				outbound.Send(map[string]interface{}{"type": "delete_done", "path": msg.Path})
			}
		case "mkdir":
			cleanPath, err := cleanLocalPath(msg.Path)
			if err == nil {
				err = os.MkdirAll(cleanPath, 0755)
			}
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				outbound.Send(map[string]interface{}{"type": "mkdir_done", "path": msg.Path})
			}
		case "rename":
			cleanPath, err := cleanLocalPath(msg.Path)
			cleanNewPath, newErr := cleanLocalPath(msg.NewPath)
			if err == nil {
				err = newErr
			}
			if err == nil {
				err = os.Rename(cleanPath, cleanNewPath)
			}
			if err != nil {
				outbound.Send(map[string]interface{}{"type": "error", "error": err.Error()})
			} else {
				outbound.Send(map[string]interface{}{"type": "rename_done", "path": msg.Path, "new_path": msg.NewPath})
			}
		case "copy", "move":
			paths := msg.Paths
			if len(paths) == 0 && msg.Path != "" {
				paths = []string{msg.Path}
			}
			destination := msg.Destination
			if destination == "" {
				destination = msg.NewPath
			}
			succeeded, failed := runLocalOperation(msg.Action, paths, destination)
			outbound.Send(map[string]interface{}{"type": "operation_done", "action": msg.Action, "request_id": msg.RequestID, "succeeded": succeeded, "failed": failed})
		}
	}
}

type fileOperationFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

func runLocalOperation(action string, sources []string, destination string) ([]string, []fileOperationFailure) {
	succeeded := make([]string, 0, len(sources))
	failed := make([]fileOperationFailure, 0)
	destination, err := cleanLocalPath(destination)
	if err != nil || destination == "" {
		if err == nil {
			err = errors.New("destination required")
		}
		for _, source := range sources {
			failed = append(failed, fileOperationFailure{source, err.Error()})
		}
		return succeeded, failed
	}
	for _, source := range sources {
		cleanSource, err := cleanLocalPath(source)
		target := filepath.Join(destination, filepath.Base(cleanSource))
		if err == nil {
			if action == "move" {
				err = moveLocal(cleanSource, target)
			} else {
				err = copyLocal(cleanSource, target)
			}
		}
		if err != nil {
			failed = append(failed, fileOperationFailure{source, err.Error()})
		} else {
			succeeded = append(succeeded, source)
		}
	}
	return succeeded, failed
}

func copyLocal(source, destination string) error {
	sourceAbs, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	destinationAbs, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	if sourceAbs == destinationAbs {
		return errors.New("source and destination are the same")
	}
	if isFilesystemRoot(sourceAbs) {
		return errors.New("refusing to copy filesystem root")
	}
	if _, err := os.Lstat(destinationAbs); err == nil {
		return errors.New("destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	info, err := os.Lstat(sourceAbs)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("copying symbolic links is not supported")
	}
	if info.IsDir() && localPathWithin(sourceAbs, destinationAbs) {
		return errors.New("destination cannot be inside source directory")
	}
	if err := copyLocalAll(sourceAbs, destinationAbs, info); err != nil {
		return cleanupLocalCopyFailure(destinationAbs, err)
	}
	return nil
}

func cleanupLocalCopyFailure(destination string, copyErr error) error {
	cleanupErr := removeLocalAll(destination)
	if cleanupErr == nil || os.IsNotExist(cleanupErr) {
		return copyErr
	}
	return errors.Join(copyErr, fmt.Errorf("cleanup partial destination: %w", cleanupErr))
}

func copyLocalAll(source, destination string, info os.FileInfo) error {
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("copying symbolic links is not supported")
	}
	if info.IsDir() {
		if err := os.MkdirAll(destination, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			entryInfo, err := entry.Info()
			if err != nil {
				return err
			}
			if err := copyLocalAll(filepath.Join(source, entry.Name()), filepath.Join(destination, entry.Name()), entryInfo); err != nil {
				return err
			}
		}
		return os.Chmod(destination, info.Mode().Perm())
	}
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func moveLocal(source, destination string) error {
	sourceAbs, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	destinationAbs, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	if sourceAbs == destinationAbs {
		return errors.New("source and destination are the same")
	}
	if isFilesystemRoot(sourceAbs) {
		return errors.New("refusing to move filesystem root")
	}
	if _, err := os.Lstat(destinationAbs); err == nil {
		return errors.New("destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	info, err := os.Lstat(sourceAbs)
	if err != nil {
		return err
	}
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 && localPathWithin(sourceAbs, destinationAbs) {
		return errors.New("destination cannot be inside source directory")
	}
	return os.Rename(sourceAbs, destinationAbs)
}

func localPathWithin(parent, candidate string) bool {
	rel, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(candidate))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func isFilesystemRoot(name string) bool {
	clean := filepath.Clean(name)
	volume := filepath.VolumeName(clean)
	return clean == filepath.Clean(volume+string(os.PathSeparator))
}

type LocalFSHandler struct{}

func (LocalFSHandler) Upload(w http.ResponseWriter, r *http.Request) {
	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, `{"error":"invalid multipart request"}`, http.StatusBadRequest)
		return
	}
	tmp, err := os.CreateTemp("", "webterm-local-upload-*")
	if err != nil {
		http.Error(w, `{"error":"cannot stage upload"}`, http.StatusInternalServerError)
		return
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	fields, found, err := stageLocalMultipart(reader, tmp)
	if err != nil || !found {
		http.Error(w, `{"error":"invalid upload"}`, http.StatusBadRequest)
		return
	}
	target, err := cleanLocalPath(fields["path"])
	if err != nil || target == "" {
		http.Error(w, `{"error":"path required"}`, http.StatusBadRequest)
		return
	}
	if _, err = tmp.Seek(0, io.SeekStart); err == nil {
		var dst *os.File
		dst, err = os.Create(target)
		if err == nil {
			_, err = io.Copy(dst, tmp)
			closeErr := dst.Close()
			if err == nil {
				err = closeErr
			}
		}
	}
	if err != nil {
		http.Error(w, `{"error":"upload failed"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "path": target})
}

func stageLocalMultipart(reader *multipart.Reader, destination io.Writer) (map[string]string, bool, error) {
	return stageMultipartUpload(reader, destination)
}

func (LocalFSHandler) Download(w http.ResponseWriter, r *http.Request) {
	name, err := cleanLocalPath(r.URL.Query().Get("path"))
	if err != nil || name == "" {
		http.Error(w, `{"error":"path required"}`, http.StatusBadRequest)
		return
	}
	file, err := os.Open(name)
	if err != nil {
		http.Error(w, `{"error":"read failed"}`, http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, `{"error":"not a regular file"}`, http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Disposition", contentDisposition(filepath.Base(name)))
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

// cleanLocalPath provides a single validation point without narrowing the
// existing filesystem scope. A configurable root can be enforced here later.
func cleanLocalPath(name string) (string, error) {
	if strings.IndexByte(name, 0) >= 0 {
		return "", errors.New("invalid path")
	}
	if name == "" {
		return "", nil
	}
	return filepath.Clean(name), nil
}

func removeLocalAll(name string) error {
	abs, err := filepath.Abs(name)
	if err != nil {
		return err
	}
	volume := filepath.VolumeName(abs)
	if filepath.Clean(abs) == filepath.Clean(volume+string(os.PathSeparator)) {
		return errors.New("refusing to remove filesystem root")
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return err
	}
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		return os.RemoveAll(abs)
	}
	return os.Remove(abs)
}
