package handlers

import (
	"context"
	"errors"
	"log/slog"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/adonis/pushops/internal/auth"
	"github.com/adonis/pushops/internal/config"
	"github.com/adonis/pushops/internal/domain"
	"github.com/adonis/pushops/internal/httpx"
	"github.com/adonis/pushops/internal/store"
)

// Handler wires the HTTP API to the data layer.
type Handler struct {
	cfg    *config.Config
	store  *store.Store
	issuer *auth.TokenIssuer
	logger *slog.Logger
	rnd    *rand.Rand
}

// New builds a Handler.
func New(cfg *config.Config, st *store.Store, issuer *auth.TokenIssuer, logger *slog.Logger) *Handler {
	return &Handler{
		cfg:    cfg,
		store:  st,
		issuer: issuer,
		logger: logger,
		rnd:    rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Register mounts every route on the router.
func (h *Handler) Register(r chi.Router) {
	r.Get("/api/variants", h.listVariants)
	r.Get("/api/config", h.clientConfig)
	r.Post("/api/auth/telegram", h.authTelegram)
	r.Post("/api/auth/dev", h.authDev)

	r.Group(func(api chi.Router) {
		api.Use(httpx.Authenticate(h.verifyToken))

		api.Get("/api/me", h.getMe)
		api.Patch("/api/me", h.patchMe)
		api.Get("/api/me/summary", h.getSummary)
		api.Get("/api/me/timeseries", h.getTimeseries)
		api.Get("/api/me/workouts", h.listWorkouts)
		api.Get("/api/me/weights", h.listWeights)
		api.Post("/api/workouts", h.createWorkout)
		api.Get("/api/workouts/{id}", h.getWorkout)

		api.Get("/api/users/search", h.searchUsers)

		api.Get("/api/friends", h.listFriends)
		api.Get("/api/friends/compare", h.compareFriends)
		api.Post("/api/friends/requests", h.requestFriend)
		api.Post("/api/friends/requests/{id}/respond", h.respondFriend)
		api.Delete("/api/friends/{id}", h.removeFriend)

		api.Get("/api/groups", h.listGroups)
		api.Post("/api/groups", h.createGroup)
		api.Post("/api/groups/join", h.joinGroup)
		api.Get("/api/groups/{id}", h.getGroup)
		api.Get("/api/groups/{id}/leaderboard", h.groupLeaderboard)
		api.Get("/api/groups/{id}/stats", h.groupStats)
		api.Post("/api/groups/{id}/leave", h.leaveGroup)

		api.Get("/api/leaderboard", h.globalLeaderboard)
	})
}

func (h *Handler) verifyToken(token string) (int64, error) {
	claims, err := h.issuer.Verify(token)
	if err != nil {
		return 0, err
	}
	return claims.UserID, nil
}

// --- helpers ---

func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "no encontrado")
	case errors.Is(err, store.ErrConflict):
		httpx.Error(w, http.StatusConflict, err.Error())
	default:
		httpx.Error(w, http.StatusBadRequest, err.Error())
	}
}

func parseInt64Param(r *http.Request, name string) (int64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return 0, false
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func queryRange(r *http.Request) (int64, int64) {
	now := time.Now()
	from := now.AddDate(0, 0, -30).UnixMilli()
	to := now.Add(24 * time.Hour).UnixMilli()
	if v, ok := parseInt64Param(r, "from"); ok {
		from = v
	}
	if v, ok := parseInt64Param(r, "to"); ok {
		to = v
	}
	if to < from {
		from, to = to, from
	}
	return from, to
}

func currentUser(ctx context.Context, st *store.Store) (*domain.User, error) {
	return st.GetUser(ctx, httpx.UserID(ctx))
}

func pathInt64(r *http.Request, name string) (int64, bool) {
	raw := chi.URLParam(r, name)
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		return 0, false
	}
	return v, true
}
