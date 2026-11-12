package handlers

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"testing"

	_ "turso.tech/database/tursogo"

	"github.com/adonis/pushops/internal/auth"
	"github.com/adonis/pushops/internal/config"
	"github.com/adonis/pushops/internal/db"
	"github.com/adonis/pushops/internal/store"
)

// newTestHandler builds a Handler over an in-memory database.
func newTestHandler(t *testing.T) (*Handler, *store.Store) {
	t.Helper()

	database, err := sql.Open("turso", ":memory:")
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := db.Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	st := store.New(database)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := &config.Config{DevMode: true, JWTSecret: "test-secret-value-long-enough"}

	return New(cfg, st, auth.NewTokenIssuer(cfg.JWTSecret), logger), st
}
