package handlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/adonis/pushops/internal/auth"
	"github.com/adonis/pushops/internal/domain"
	"github.com/adonis/pushops/internal/httpx"
	"github.com/adonis/pushops/internal/store"
)

type authRequest struct {
	InitData string `json:"initData"`
}

// authTelegram validates Telegram initData and returns a session token.
func (h *Handler) authTelegram(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "cuerpo de la petición inválido")
		return
	}
	if !h.cfg.HasTelegram() {
		httpx.Error(w, http.StatusServiceUnavailable, "la autenticación de Telegram no está configurada")
		return
	}

	initData, err := auth.ValidateInitData(h.cfg.TelegramBotToken, req.InitData)
	if err != nil {
		httpx.Error(w, http.StatusUnauthorized, "initData de Telegram inválido")
		return
	}
	if initData.User == nil {
		httpx.Error(w, http.StatusUnauthorized, "initData de Telegram sin usuario")
		return
	}

	user, isNew, err := h.store.EnsureUser(r.Context(), initData.User, h.rnd)
	if err != nil {
		h.logger.Error("ensure user", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "no se pudo crear la cuenta")
		return
	}

	token, expires, err := h.issuer.Issue(user.ID, user.TgID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "no se pudo emitir la sesión")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"expiresAt": expires.UnixMilli(),
		"user":      user,
		"isNew":     isNew,
	})
}

type devAuthRequest struct {
	TgID     int64  `json:"tgId"`
	Nickname string `json:"nickname"`
}

// authDev creates a session without Telegram, for local development only.
func (h *Handler) authDev(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.DevMode {
		httpx.Error(w, http.StatusNotFound, "no encontrado")
		return
	}
	var req devAuthRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "cuerpo de la petición inválido")
		return
	}
	if req.TgID <= 0 {
		req.TgID = 900000001
	}

	tg := &auth.TelegramUser{ID: req.TgID, FirstName: "Dev", Username: "devuser"}
	user, isNew, err := h.store.EnsureUser(r.Context(), tg, h.rnd)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "no se pudo crear la cuenta")
		return
	}
	if req.Nickname != "" {
		if err := h.store.UpdateNickname(r.Context(), user.ID, req.Nickname); err != nil {
			writeDomainError(w, err)
			return
		}
		user, _ = h.store.GetUser(r.Context(), user.ID)
	}
	token, expires, err := h.issuer.Issue(user.ID, user.TgID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "no se pudo emitir la sesión")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"expiresAt": expires.UnixMilli(),
		"user":      user,
		"isNew":     isNew,
	})
}

// listVariants exposes the push-up variant catalogue.
func (h *Handler) listVariants(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"variants": domain.Variants})
}

// clientConfig tells the SPA which server-side features are enabled.
func (h *Handler) clientConfig(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"telegramAuth": h.cfg.HasTelegram(),
		"devMode":      h.cfg.DevMode,
		"serverTime":   time.Now().UnixMilli(),
	})
}

// --- profile ---

type patchMeRequest struct {
	Nickname string   `json:"nickname"`
	WeightKg *float64 `json:"weightKg"`
}

func (h *Handler) getMe(w http.ResponseWriter, r *http.Request) {
	user, err := currentUser(r.Context(), h.store)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"user":        user,
		"weightStale": user.WeightStale(time.Now()),
	})
}

func (h *Handler) patchMe(w http.ResponseWriter, r *http.Request) {
	var req patchMeRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "cuerpo de la petición inválido")
		return
	}
	userID := httpx.UserID(r.Context())

	if strings.TrimSpace(req.Nickname) != "" {
		if err := h.store.UpdateNickname(r.Context(), userID, req.Nickname); err != nil {
			if errors.Is(err, store.ErrConflict) {
				httpx.Error(w, http.StatusConflict, err.Error())
				return
			}
			httpx.Error(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if req.WeightKg != nil {
		weight := *req.WeightKg
		if weight < 25 || weight > 250 {
			httpx.Error(w, http.StatusBadRequest, "el peso debe estar entre 25 y 250 kg")
			return
		}
		if err := h.store.UpdateWeight(r.Context(), userID, weight); err != nil {
			writeDomainError(w, err)
			return
		}
	}

	user, err := h.store.GetUser(r.Context(), userID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"user":        user,
		"weightStale": user.WeightStale(time.Now()),
	})
}

func (h *Handler) getSummary(w http.ResponseWriter, r *http.Request) {
	from, to := queryRange(r)
	userID := httpx.UserID(r.Context())
	summary, err := h.store.Summary(r.Context(), userID, from, to)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	user, err := h.store.GetUser(r.Context(), userID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"summary":     summary,
		"weightStale": user.WeightStale(time.Now()),
		"from":        from,
		"to":          to,
	})
}

func (h *Handler) getTimeseries(w http.ResponseWriter, r *http.Request) {
	from, to := queryRange(r)
	bucket := r.URL.Query().Get("bucket")
	if bucket != "week" && bucket != "month" {
		bucket = "day"
	}
	buckets, err := h.store.Timeseries(r.Context(), httpx.UserID(r.Context()), from, to, bucket)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"buckets": buckets, "bucket": bucket})
}

func (h *Handler) listWorkouts(w http.ResponseWriter, r *http.Request) {
	limit, _ := parseInt64Param(r, "limit")
	offset, _ := parseInt64Param(r, "offset")
	list, err := h.store.ListWorkouts(r.Context(), httpx.UserID(r.Context()), int(limit), int(offset))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"workouts": list})
}

func (h *Handler) listWeights(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.WeightHistory(r.Context(), httpx.UserID(r.Context()), 30)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"weights": list})
}
