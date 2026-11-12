package handlers

import (
	"net/http"
	"strings"

	"github.com/adonis/pushops/internal/httpx"
	"github.com/adonis/pushops/internal/store"
)

// listGroups returns the groups the viewer belongs to.
func (h *Handler) listGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.store.ListGroups(r.Context(), httpx.UserID(r.Context()))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"groups": groups})
}

type createGroupRequest struct {
	Name      string `json:"name"`
	IsPrivate bool   `json:"isPrivate"`
}

// createGroup creates a group owned by the viewer.
func (h *Handler) createGroup(w http.ResponseWriter, r *http.Request) {
	var req createGroupRequest
	if !h.decode(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if len([]rune(name)) < 2 {
		httpx.Error(w, http.StatusBadRequest, "el nombre del grupo es demasiado corto")
		return
	}
	group, err := h.store.CreateGroup(r.Context(), httpx.UserID(r.Context()), name, req.IsPrivate)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"group": group})
}

type joinGroupRequest struct {
	Code string `json:"code"`
}

// joinGroup joins a group using an invite code.
func (h *Handler) joinGroup(w http.ResponseWriter, r *http.Request) {
	var req joinGroupRequest
	if !h.decode(w, r, &req) {
		return
	}
	group, err := h.store.JoinGroup(r.Context(), httpx.UserID(r.Context()), req.Code)
	if err != nil {
		if err == store.ErrNotFound {
			httpx.Error(w, http.StatusNotFound, "no existe ningún grupo con ese código")
			return
		}
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"group": group})
}

// getGroup returns a single group the viewer belongs to.
func (h *Handler) getGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt64(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return
	}
	role, err := h.store.Membership(r.Context(), id, httpx.UserID(r.Context()))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	if role == "" {
		httpx.Error(w, http.StatusForbidden, "no perteneces a ese grupo")
		return
	}
	group, err := h.store.GetGroup(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	group.Role = role
	httpx.JSON(w, http.StatusOK, map[string]any{"group": group})
}

// groupLeaderboard ranks the members of a group.
func (h *Handler) groupLeaderboard(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt64(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return
	}
	role, err := h.store.Membership(r.Context(), id, httpx.UserID(r.Context()))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	if role == "" {
		httpx.Error(w, http.StatusForbidden, "no perteneces a ese grupo")
		return
	}
	from, to := queryRange(r)
	metric := r.URL.Query().Get("metric")
	if !store.ValidMetric(metric) {
		metric = store.MetricPoints
	}
	members, err := h.store.GroupMemberIDs(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	entries, err := h.store.Leaderboard(r.Context(), store.LeaderboardOptions{
		Metric:      metric,
		From:        from,
		To:          to,
		OnlyUserIDs: members,
		ViewerID:    httpx.UserID(r.Context()),
	})
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"entries": entries, "metric": metric})
}

// groupStats returns the aggregate statistics of a group.
func (h *Handler) groupStats(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt64(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return
	}
	role, err := h.store.Membership(r.Context(), id, httpx.UserID(r.Context()))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	if role == "" {
		httpx.Error(w, http.StatusForbidden, "no perteneces a ese grupo")
		return
	}
	from, to := queryRange(r)
	totals, err := h.store.GroupSummary(r.Context(), id, from, to)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	series, err := h.store.GroupDailySeries(r.Context(), id, from, to)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	members, err := h.store.GroupMemberStats(r.Context(), id, from, to)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"totals":  totals,
		"series":  series,
		"members": members,
	})
}

// leaveGroup removes the viewer from a group.
func (h *Handler) leaveGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt64(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return
	}
	if err := h.store.LeaveGroup(r.Context(), id, httpx.UserID(r.Context())); err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
