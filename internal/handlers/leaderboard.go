package handlers

import (
	"net/http"

	"github.com/adonis/pushops/internal/httpx"
	"github.com/adonis/pushops/internal/store"
)

// globalLeaderboard ranks every trusted user.
//
// The points ranking excludes accounts whose body weight has not been confirmed
// recently, so nobody can inflate their score by editing their weight and never
// coming back to it.
func (h *Handler) globalLeaderboard(w http.ResponseWriter, r *http.Request) {
	from, to := queryRange(r)
	metric := r.URL.Query().Get("metric")
	if !store.ValidMetric(metric) {
		metric = store.MetricPoints
	}
	limit := 50
	if v, ok := parseInt64Param(r, "limit"); ok && v > 0 && v <= 200 {
		limit = int(v)
	}

	entries, err := h.store.Leaderboard(r.Context(), store.LeaderboardOptions{
		Metric:              metric,
		From:                from,
		To:                  to,
		Limit:               limit,
		MinTrust:            2,
		ViewerID:            httpx.UserID(r.Context()),
		ExcludeStaleWeights: metric == store.MetricPoints,
	})
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"entries": entries, "metric": metric})
}
