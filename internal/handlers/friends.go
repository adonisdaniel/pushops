package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/adonis/pushops/internal/httpx"
	"github.com/adonis/pushops/internal/store"
)

// listFriends returns accepted friends and pending incoming requests.
func (h *Handler) listFriends(w http.ResponseWriter, r *http.Request) {
	friends, incoming, err := h.store.ListFriends(r.Context(), httpx.UserID(r.Context()))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"friends":  friends,
		"incoming": incoming,
	})
}

type requestFriendRequest struct {
	Query string `json:"query"`
}

// requestFriend sends a friendship request to a nickname or Telegram username.
func (h *Handler) requestFriend(w http.ResponseWriter, r *http.Request) {
	var req requestFriendRequest
	if !h.decode(w, r, &req) {
		return
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		httpx.Error(w, http.StatusBadRequest, "indica un nickname o un usuario de Telegram")
		return
	}
	target, err := h.store.FindUser(r.Context(), query)
	if err != nil {
		if err == store.ErrNotFound {
			httpx.Error(w, http.StatusNotFound, "no hay ningún usuario con ese nombre")
			return
		}
		writeDomainError(w, err)
		return
	}
	friendship, err := h.store.RequestFriend(r.Context(), httpx.UserID(r.Context()), target.ID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"friendship": friendship})
}

type respondFriendRequest struct {
	Accept bool `json:"accept"`
}

// respondFriend accepts or declines a pending request.
func (h *Handler) respondFriend(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt64(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return
	}
	var req respondFriendRequest
	if !h.decode(w, r, &req) {
		return
	}
	if err := h.store.RespondFriend(r.Context(), httpx.UserID(r.Context()), id, req.Accept); err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// removeFriend deletes a friendship.
func (h *Handler) removeFriend(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt64(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return
	}
	if err := h.store.RemoveFriend(r.Context(), httpx.UserID(r.Context()), id); err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// compareFriends ranks the viewer against a set of users.
func (h *Handler) compareFriends(w http.ResponseWriter, r *http.Request) {
	from, to := queryRange(r)
	viewerID := httpx.UserID(r.Context())

	ids := []int64{viewerID}
	if raw := r.URL.Query().Get("ids"); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			v, err := strconv.ParseInt(part, 10, 64)
			if err != nil || v <= 0 || v == viewerID {
				continue
			}
			ids = append(ids, v)
		}
	}
	if len(ids) > 12 {
		ids = ids[:12]
	}

	metric := r.URL.Query().Get("metric")
	if !store.ValidMetric(metric) {
		metric = store.MetricPoints
	}
	entries, err := h.store.Leaderboard(r.Context(), store.LeaderboardOptions{
		Metric:      metric,
		From:        from,
		To:          to,
		OnlyUserIDs: ids,
		ViewerID:    viewerID,
	})
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"entries": entries,
		"metric":  metric,
		"from":    from,
		"to":      to,
	})
}

// searchUsers finds users by nickname or Telegram username.
func (h *Handler) searchUsers(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) < 2 {
		httpx.JSON(w, http.StatusOK, map[string]any{"users": []any{}})
		return
	}
	users, err := h.store.SearchUsers(r.Context(), query, 20)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		if u.ID == httpx.UserID(r.Context()) {
			continue
		}
		out = append(out, map[string]any{
			"id":         u.ID,
			"nickname":   u.Nickname,
			"tgUsername": u.TgUsername,
			"photoUrl":   u.PhotoURL,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"users": out})
}
