package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Context keys.
type ctxKey string

const (
	ctxUserID ctxKey = "userID"
	ctxClaims ctxKey = "claims"
)

// JSON writes a JSON response with the given status code.
func JSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("write json response", "error", err)
	}
}

// Error writes a JSON error payload.
func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, map[string]any{"error": message})
}

// DecodeJSON reads a JSON body with a size limit.
func DecodeJSON(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// UserID returns the authenticated user id stored in the context.
func UserID(ctx context.Context) int64 {
	if v, ok := ctx.Value(ctxUserID).(int64); ok {
		return v
	}
	return 0
}

// WithUser stores the authenticated user id in the context.
func WithUser(ctx context.Context, id int64) context.Context {
	return context.WithValue(ctx, ctxUserID, id)
}

// NewRouter builds the HTTP router with the shared middleware stack.
func NewRouter(allowOrigins []string, logger *slog.Logger) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(recoverer)
	r.Use(requestLogger(logger))
	r.Use(cors(allowOrigins))
	r.Use(cleanPath)

	r.Get("/healthz", func(w http.ResponseWriter, req *http.Request) {
		JSON(w, http.StatusOK, map[string]any{"ok": true, "time": time.Now().UnixMilli()})
	})
	return r
}

func cleanPath(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := strings.TrimRight(r.URL.Path, "/"); p != "" {
			r.URL.Path = p
		}
		next.ServeHTTP(w, r)
	})
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered", "path", r.URL.Path, "panic", rec)
				Error(w, http.StatusInternalServerError, "error interno del servidor")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

func cors(allowOrigins []string) func(http.Handler) http.Handler {
	allowAll := len(allowOrigins) == 0
	set := map[string]bool{}
	for _, o := range allowOrigins {
		if o == "*" {
			allowAll = true
		}
		set[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if allowAll {
					w.Header().Set("Access-Control-Allow-Origin", "*")
				} else if set[origin] {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
				}
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimiter is a simple in-memory fixed-window limiter keyed by client IP.
type RateLimiter struct {
	mu       sync.Mutex
	counts   map[string]windowCount
	limit    int
	window   time.Duration
	disabled bool
}

type windowCount struct {
	count int
	start time.Time
}

// NewRateLimiter builds a limiter allowing limit requests per window.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{counts: map[string]windowCount{}, limit: limit, window: window}
}

// Allow reports whether a request from key may proceed.
func (rl *RateLimiter) Allow(key string) bool {
	if rl == nil || rl.disabled {
		return true
	}
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	wc, ok := rl.counts[key]
	if !ok || now.Sub(wc.start) > rl.window {
		rl.counts[key] = windowCount{count: 1, start: now}
		return true
	}
	if wc.count >= rl.limit {
		return false
	}
	wc.count++
	rl.counts[key] = wc
	return true
}

// RateLimit wraps a handler with the given limiter.
func RateLimit(rl *RateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !rl.Allow(clientKey(r)) {
				w.Header().Set("Retry-After", "60")
				Error(w, http.StatusTooManyRequests, "demasiadas peticiones, inténtalo en un momento")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientKey(r *http.Request) string {
	if uid := UserID(r.Context()); uid > 0 {
		return "u:" + strconv.FormatInt(uid, 10)
	}
	ip := r.Header.Get("X-Forwarded-For")
	if i := strings.Index(ip, ","); i > 0 {
		ip = ip[:i]
	}
	if ip == "" {
		ip = r.RemoteAddr
	}
	return "ip:" + strings.TrimSpace(ip)
}
