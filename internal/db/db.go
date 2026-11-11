package db

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "turso.tech/database/tursogo"
	_ "turso.tech/database/tursogo-serverless"

	"github.com/adonis/pushops/internal/config"
	"github.com/adonis/pushops/migrations"
)

// Open connects to the database. A remote Turso URL uses the pure-Go HTTP driver;
// a local path uses the embedded engine so development works without the cloud.
func Open(ctx context.Context, cfg *config.Config) (*sql.DB, error) {
	dsn, driverName := buildDSN(cfg)

	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open: %w", err)
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return db, nil
}

// buildDSN returns the driver name and the DSN for the configured database.
// A remote Turso URL uses the pure-Go HTTP driver; a local path uses the
// embedded engine so development works without the cloud.
func buildDSN(cfg *config.Config) (string, string) {
	raw := cfg.DatabaseURL
	if isLocalPath(raw) {
		// Make sure the directory exists before the engine tries to open the file.
		if dir := filepath.Dir(raw); dir != "" && dir != "." {
			_ = os.MkdirAll(dir, 0o755)
		}
		return raw, "turso"
	}
	if cfg.AuthToken == "" {
		return raw, "turso-serverless"
	}
	sep := "?"
	if strings.Contains(raw, "?") {
		sep = "&"
	}
	return raw + sep + "auth_token=" + url.QueryEscape(cfg.AuthToken), "turso-serverless"
}

// isLocalPath reports whether the configured URL points at a local file.
func isLocalPath(raw string) bool {
	if raw == "" {
		return false
	}
	if strings.Contains(raw, "://") {
		return false
	}
	return true
}

// Migrate applies every embedded migration that has not been recorded yet.
func Migrate(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    INTEGER PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("db: create schema_migrations: %w", err)
	}

	applied := map[int]bool{}
	rows, err := db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("db: read schema_migrations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return err
		}
		applied[v] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		version := versionFromName(name)
		if applied[version] {
			continue
		}
		content, err := migrations.FS.ReadFile(name)
		if err != nil {
			return err
		}
		stmts := SplitStatements(string(content))
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		for _, s := range stmts {
			if _, err := tx.ExecContext(ctx, s); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("db: migration %s: %w\nstatement: %s", name, err, s)
			}
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
			version, time.Now().UnixMilli()); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func versionFromName(name string) int {
	base := strings.TrimSuffix(filepath.Base(name), ".sql")
	var v int
	_, _ = fmt.Sscanf(base, "%d", &v)
	return v
}

// SplitStatements splits a SQL script into individual statements, ignoring
// semicolons inside string literals and comments.
func SplitStatements(script string) []string {
	var out []string
	var cur strings.Builder
	inSingle, inDouble, inLineComment, inBlockComment := false, false, false, false

	runes := []rune(script)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		next := rune(0)
		if i+1 < len(runes) {
			next = runes[i+1]
		}

		switch {
		case inLineComment:
			if c == '\n' {
				inLineComment = false
				cur.WriteRune(c)
			}
			continue
		case inBlockComment:
			if c == '*' && next == '/' {
				inBlockComment = false
				i++
			}
			continue
		case inSingle:
			cur.WriteRune(c)
			if c == '\'' {
				inSingle = false
			}
			continue
		case inDouble:
			cur.WriteRune(c)
			if c == '"' {
				inDouble = false
			}
			continue
		}

		switch {
		case c == '-' && next == '-':
			inLineComment = true
			i++
		case c == '/' && next == '*':
			inBlockComment = true
			i++
		case c == '\'':
			inSingle = true
			cur.WriteRune(c)
		case c == '"':
			inDouble = true
			cur.WriteRune(c)
		case c == ';':
			if s := strings.TrimSpace(cur.String()); s != "" {
				out = append(out, s)
			}
			cur.Reset()
		default:
			cur.WriteRune(c)
		}
	}
	if s := strings.TrimSpace(cur.String()); s != "" {
		out = append(out, s)
	}
	return out
}

// LocalDBPath is a helper for development: returns a path inside the working dir.
func LocalDBPath(name string) string {
	return filepath.Join(".data", name)
}

// EnsureLocalDir creates the directory that holds local database files.
func EnsureLocalDir() error {
	return os.MkdirAll(".data", 0o755)
}
