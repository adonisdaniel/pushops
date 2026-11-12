package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/adonis/pushops/internal/domain"
	"github.com/adonis/pushops/internal/httpx"
)

// repPayload is a repetition as the client sends it.
//
// The timestamps arrive as JSON numbers with decimals (performance.now() has
// sub-millisecond precision), so they are decoded as float64 and rounded.
// Decoding them straight into an int64 made every single workout fail with
// "json: cannot unmarshal number 12345.678 into Go value of type int64".
type repPayload struct {
	TMs        float64 `json:"tMs"`
	DurationMs float64 `json:"durationMs"`
	FillMax    float64 `json:"fillMax"`
	ElbowMin   float64 `json:"elbowMin"`
	OK         bool    `json:"ok"`
	Conf       float64 `json:"conf"`
}

type createWorkoutRequest struct {
	ClientID  string         `json:"clientId"`
	Variant   string         `json:"variant"`
	Mode      string         `json:"mode"`
	StartedAt float64        `json:"startedAt"`
	EndedAt   float64        `json:"endedAt"`
	LocalDate string         `json:"localDate"`
	Reps      []repPayload   `json:"reps"`
	Meta      map[string]any `json:"meta"`
}

// toDomain converts the wire format into the domain model.
func (r *createWorkoutRequest) toDomain() *domain.WorkoutInput {
	reps := make([]domain.RepInput, 0, len(r.Reps))
	for _, p := range r.Reps {
		reps = append(reps, domain.RepInput{
			TMs:        int64(math.Round(p.TMs)),
			DurationMs: int64(math.Round(p.DurationMs)),
			FillMax:    p.FillMax,
			ElbowMin:   p.ElbowMin,
			OK:         p.OK,
			Conf:       p.Conf,
		})
	}
	return &domain.WorkoutInput{
		Variant:   r.Variant,
		Mode:      r.Mode,
		StartedAt: int64(math.Round(r.StartedAt)),
		EndedAt:   int64(math.Round(r.EndedAt)),
		Reps:      reps,
	}
}

// validModes are the camera placements the detector supports.
var validModes = map[string]bool{"suelo": true, "perfil": true, "manual": true}

// createWorkout stores a finished set. The server decides which repetitions are
// valid and computes the score; the client is never trusted for either.
func (h *Handler) createWorkout(w http.ResponseWriter, r *http.Request) {
	var req createWorkoutRequest
	if !h.decode(w, r, &req) {
		return
	}
	if req.Variant == "" {
		req.Variant = "standard"
	}
	if req.Mode == "" {
		req.Mode = "suelo"
	}
	if !validModes[req.Mode] {
		h.logger.Warn("workout rejected", "reason", "unknown camera mode", "mode", req.Mode)
		httpx.Error(w, http.StatusBadRequest, "modo de cámara desconocido")
		return
	}
	variant := domain.VariantByKey(req.Variant)

	in := req.toDomain()
	result := domain.ValidateWorkout(in)
	if result.Reason != "" {
		h.logger.Warn("workout rejected",
			"reason", result.Reason,
			"user", httpx.UserID(r.Context()),
			"reps", len(result.Reps))
		httpx.Error(w, http.StatusUnprocessableEntity, "la sesión no supera las comprobaciones: "+result.Reason)
		return
	}
	if result.ValidCount < domain.MinValidReps {
		h.logger.Warn("workout rejected",
			"reason", "not enough valid repetitions",
			"user", httpx.UserID(r.Context()),
			"valid", result.ValidCount)
		httpx.Error(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("una serie necesita al menos %d flexiones válidas", domain.MinValidReps))
		return
	}

	userID := httpx.UserID(r.Context())
	localDate := sanitizeLocalDate(req.LocalDate, int64(math.Round(req.EndedAt)))

	// Score with the body weight that was declared at the time of the workout.
	weight, err := h.store.WeightAt(r.Context(), userID, int64(math.Round(req.StartedAt)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	dates, err := h.store.ActiveDates(r.Context(), userID,
		int64(math.Round(req.StartedAt))-90*24*3600*1000, int64(math.Round(req.EndedAt)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	streak := domain.StreakDays(dates, time.Now())
	points := domain.ScorePoints(result.ValidCount, req.Variant, weight, streak)

	metaJSON := ""
	if len(req.Meta) > 0 {
		if b, err := json.Marshal(req.Meta); err == nil {
			metaJSON = string(b)
		}
	}

	workout := &domain.Workout{
		UserID:     userID,
		ClientID:   strings.TrimSpace(req.ClientID),
		Variant:    req.Variant,
		Mode:       req.Mode,
		StartedAt:  int64(math.Round(req.StartedAt)),
		EndedAt:    int64(math.Round(req.EndedAt)),
		LocalDate:  localDate,
		DurationMs: result.DurationMs,
		RepsTotal:  len(result.Reps),
		RepsValid:  result.ValidCount,
		AvgRepMs:   result.AvgRepMs,
		BestRepMs:  result.BestRepMs,
		Points:     points,
		Meta:       metaJSON,
	}
	id, err := h.store.CreateWorkout(r.Context(), workout, result.Reps)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	// Promote the trust level once enough sets have been recorded.
	if count, err := h.store.CountWorkouts(r.Context(), userID); err == nil {
		_ = h.store.BumpTrustLevel(r.Context(), userID, count)
	}

	httpx.JSON(w, http.StatusCreated, map[string]any{
		"id":          id,
		"repsValid":   result.ValidCount,
		"repsInvalid": result.InvalidCount,
		"points":      points,
		"weightKg":    weight,
		"streak":      streak,
		"durationMs":  result.DurationMs,
		"avgRepMs":    result.AvgRepMs,
		"bestRepMs":   result.BestRepMs,
		"minDepth":    variant.ReqMinDepth,
	})
}

// sanitizeLocalDate keeps the client-provided date but refuses values that are far
// from the server's own clock, so streaks cannot be forged by hand.
func sanitizeLocalDate(raw string, endedAt int64) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.UnixMilli(endedAt).UTC().Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", raw); err != nil {
		return time.UnixMilli(endedAt).UTC().Format("2006-01-02")
	}
	parsed, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return ""
	}
	server := time.UnixMilli(endedAt).UTC()
	delta := parsed.Sub(server)
	if delta < 0 {
		delta = -delta
	}
	if delta > 36*time.Hour {
		return server.Format("2006-01-02")
	}
	return raw
}

func (h *Handler) getWorkout(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt64(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return
	}
	workout, err := h.store.GetWorkout(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	if workout.UserID != httpx.UserID(r.Context()) {
		httpx.Error(w, http.StatusForbidden, "esta sesión no es tuya")
		return
	}
	reps, err := h.store.GetWorkoutReps(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"workout": workout, "reps": reps})
}
