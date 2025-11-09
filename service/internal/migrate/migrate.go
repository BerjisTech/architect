package migrate

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jmoiron/sqlx"
)

type Runner struct{ Dir string }

func (r Runner) Up(db *sqlx.DB) error {
	if db == nil {
		return nil
	}
	var files []string
	_ = filepath.WalkDir(r.Dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".sql") {
			files = append(files, path)
		}
		return nil
	})
	sort.Strings(files)
	for _, f := range files {
		if b, err := os.ReadFile(f); err == nil {
			if _, err := db.Exec(string(b)); err != nil {
				return err
			}
		}
	}
	return nil
}
