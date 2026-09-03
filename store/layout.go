package store

import (
	"database/sql"
	"errors"
)

var ErrLayoutConflict = errors.New("layout revision conflict")

type UserLayout struct {
	UserID        int64
	SchemaVersion int
	Revision      int64
	LayoutJSON    []byte
}

func (s *Store) GetUserLayout(userID int64) (*UserLayout, error) {
	layout := &UserLayout{UserID: userID, SchemaVersion: 1, Revision: 0, LayoutJSON: []byte(`{"tree":{"type":"leaf","id":"root"},"panes":{"root":{"tabs":[],"activeTabId":null}},"focusedPaneId":"root"}`)}
	err := s.DB.QueryRow("SELECT schema_version, revision, layout_json FROM user_layouts WHERE user_id=?", userID).Scan(&layout.SchemaVersion, &layout.Revision, &layout.LayoutJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return layout, nil
	}
	if err != nil {
		return nil, err
	}
	return layout, nil
}

func (s *Store) SaveUserLayout(userID int64, schemaVersion int, revision int64, layoutJSON []byte) (int64, error) {
	if revision == 0 {
		_, err := s.DB.Exec("INSERT INTO user_layouts (user_id, schema_version, revision, layout_json) VALUES (?, ?, 1, ?)", userID, schemaVersion, string(layoutJSON))
		if err != nil {
			return 0, ErrLayoutConflict
		}
		return 1, nil
	}
	result, err := s.DB.Exec("UPDATE user_layouts SET schema_version=?, revision=revision+1, layout_json=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND revision=?", schemaVersion, string(layoutJSON), userID, revision)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if affected != 1 {
		return 0, ErrLayoutConflict
	}
	return revision + 1, nil
}
