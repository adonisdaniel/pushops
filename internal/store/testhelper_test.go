package store

import (
	"context"
	"database/sql"

	_ "turso.tech/database/tursogo"

	"github.com/adonis/pushops/internal/db"
)

// openTestDB returns an in-memory database with the schema applied.
func openTestDB() (*sql.DB, error) {
	database, err := sql.Open("turso", ":memory:")
	if err != nil {
		return nil, err
	}
	if err := db.Migrate(context.Background(), database); err != nil {
		_ = database.Close()
		return nil, err
	}
	return database, nil
}
