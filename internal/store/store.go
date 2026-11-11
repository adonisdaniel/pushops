package store

import (
	"database/sql"
	"errors"
	"fmt"
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("store: not found")

// ErrConflict is returned when a uniqueness constraint would be violated.
var ErrConflict = errors.New("store: conflict")

// Store is the data access layer.
type Store struct {
	db *sql.DB
}

// New builds a Store over a database handle.
func New(db *sql.DB) *Store { return &Store{db: db} }

// DB exposes the underlying handle for health checks.
func (s *Store) DB() *sql.DB { return s.db }

// Health verifies the database is reachable.
func (s *Store) Health() error { return s.db.Ping() }

// isUniqueViolation reports whether an error is a uniqueness conflict.
// The message differs between the embedded engine and the HTTP driver.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return contains(msg, "UNIQUE constraint failed") ||
		contains(msg, "constraint failed: UNIQUE") ||
		contains(msg, "duplicate key") ||
		contains(msg, "PRIMARY KEY constraint failed")
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

func wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	if isUniqueViolation(err) {
		return fmt.Errorf("%w: %v", ErrConflict, err)
	}
	return fmt.Errorf("%s: %w", op, err)
}
