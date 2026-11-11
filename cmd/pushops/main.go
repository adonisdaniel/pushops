// Command pushops serves the PushOps Telegram Mini App: a Go API plus the
// embedded vanilla-JS single page application.
package main

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/adonis/pushops"
	"github.com/adonis/pushops/internal/auth"
	"github.com/adonis/pushops/internal/config"
	"github.com/adonis/pushops/internal/db"
	"github.com/adonis/pushops/internal/handlers"
	"github.com/adonis/pushops/internal/httpx"
	"github.com/adonis/pushops/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("server exited with error", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	database, err := db.Open(ctx, cfg)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()

	if err := db.Migrate(ctx, database); err != nil {
		return err
	}
	logger.Info("database ready")

	st := store.New(database)
	issuer := auth.NewTokenIssuer(cfg.JWTSecret)
	h := handlers.New(cfg, st, issuer, logger)

	router := httpx.NewRouter(cfg.AllowOrigins, logger)
	h.Register(router)

	if err := mountAssets(router); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("pushops listening", "addr", srv.Addr, "public_url", cfg.PublicURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			cancel()
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	return srv.Shutdown(shutdownCtx)
}

// mountAssets serves the embedded SPA and the pose model files.
func mountAssets(router chi.Router) error {
	webFS, err := fs.Sub(pushops.FS, "web")
	if err != nil {
		return err
	}
	staticFS, err := fs.Sub(pushops.FS, "static")
	if err != nil {
		return err
	}

	router.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))

	fileServer := http.FileServer(http.FS(webFS))
	indexHTML, err := fs.ReadFile(webFS, "index.html")
	if err != nil {
		return err
	}
	router.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}
		// fs.FS paths are unrooted, so the leading slash has to go.
		name := strings.TrimPrefix(path, "/")
		if f, err := webFS.Open(name); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(indexHTML)
	})
	return nil
}
