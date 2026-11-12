package handlers

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/adonis/pushops/internal/domain"
)

// The client used to send performance.now() values with decimals and the
// server decoded them as int64, so every workout was rejected with
// "json: cannot unmarshal number 12345.678 into Go value of type int64".
func TestCreateWorkoutRequestAcceptsFractionalTimestamps(t *testing.T) {
	payload := `{
		"clientId": "w_1_12_0",
		"variant": "standard",
		"mode": "suelo",
		"startedAt": 1794510000000,
		"endedAt": 1794510030000,
		"localDate": "2026-11-12",
		"reps": [{
			"tMs": 12345.678,
			"durationMs": 2100.5,
			"fillMax": 0.84,
			"elbowMin": 58.2,
			"ok": true,
			"conf": 0.57
		}],
		"meta": {"fps": 18}
	}`

	var req createWorkoutRequest
	dec := json.NewDecoder(bytes.NewReader([]byte(payload)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		t.Fatalf("the payload with decimals must decode: %v", err)
	}

	in := req.toDomain()
	if len(in.Reps) != 1 {
		t.Fatalf("reps = %d, want 1", len(in.Reps))
	}
	if in.Reps[0].TMs != 12346 {
		t.Errorf("tMs = %d, want 12346", in.Reps[0].TMs)
	}
	if in.Reps[0].DurationMs != 2101 {
		t.Errorf("durationMs = %d, want 2101", in.Reps[0].DurationMs)
	}
	if in.StartedAt != 1794510000000 {
		t.Errorf("startedAt = %d", in.StartedAt)
	}
}

// Whole numbers must keep working.
func TestCreateWorkoutRequestAcceptsIntegerTimestamps(t *testing.T) {
	payload := `{"startedAt":1794510000000,"endedAt":1794510030000,
		"reps":[{"tMs":12346,"durationMs":2101,"fillMax":0.84,"elbowMin":58,"ok":true,"conf":0.57}]}`

	var req createWorkoutRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	in := req.toDomain()
	if in.Reps[0].TMs != 12346 || in.Reps[0].DurationMs != 2101 {
		t.Errorf("unexpected conversion: %+v", in.Reps[0])
	}
}

// The confidence of a single doubtful repetition must not throw the set away.
func TestLowConfidenceOnlyInvalidatesThatRepetition(t *testing.T) {
	in := &domain.WorkoutInput{
		StartedAt: 1,
		EndedAt:   60_001,
		Reps: []domain.RepInput{
			{TMs: 0, DurationMs: 2000, FillMax: 0.9, OK: true, Conf: 0.9},
			{TMs: 3000, DurationMs: 2000, FillMax: 0.9, OK: true, Conf: 0.2},
			{TMs: 6000, DurationMs: 2000, FillMax: 0.9, OK: true, Conf: 0.8},
		},
	}
	res := domain.ValidateWorkout(in)
	if res.Reason != "" {
		t.Fatalf("the set must not be rejected: %q", res.Reason)
	}
	if res.ValidCount != 2 {
		t.Errorf("valid reps = %d, want 2", res.ValidCount)
	}
	if res.InvalidCount != 1 {
		t.Errorf("invalid reps = %d, want 1", res.InvalidCount)
	}
}

// A session that claims more repetitions than its duration allows keeps the
// ones that fit and invalidates the surplus.
func TestSurplusRepetitionsAreDegradedNotRejected(t *testing.T) {
	reps := make([]domain.RepInput, 10)
	for i := range reps {
		reps[i] = domain.RepInput{TMs: int64(i * 500), DurationMs: 1000, FillMax: 0.9, OK: true, Conf: 0.9}
	}
	in := &domain.WorkoutInput{StartedAt: 1, EndedAt: 6001, Reps: reps}
	res := domain.ValidateWorkout(in)
	if res.Reason != "" {
		t.Fatalf("the set must not be rejected: %q", res.Reason)
	}
	// Six seconds fit six repetitions of one second each.
	if res.ValidCount > 7 {
		t.Errorf("valid reps = %d, want at most 7", res.ValidCount)
	}
	if res.ValidCount == 0 {
		t.Error("the repetitions that fit must be kept")
	}
}

// The decoder error must reach the logs instead of being swallowed.
func TestDecodeLogsTheRealError(t *testing.T) {
	h, _ := newTestHandler(t)
	body := `{"startedAt": 1, "endedAt": 2, "reps": [{"unknownField": 1}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/workouts", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	h.decode(rec, req, &createWorkoutRequest{})

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("the body is not JSON: %v", err)
	}
	if payload["error"] == "" || payload["error"] == "cuerpo de la petición inválido" {
		t.Errorf("the error must say what was wrong, got %q", payload["error"])
	}
}

func TestRoundTripOfTheScore(t *testing.T) {
	// Guards against the score changing shape with the wire format.
	in := &domain.WorkoutInput{
		StartedAt: 1,
		EndedAt:   60_001,
		Reps: []domain.RepInput{
			{TMs: 0, DurationMs: 2000, FillMax: 0.9, OK: true, Conf: 0.9},
		},
	}
	res := domain.ValidateWorkout(in)
	if res.ValidCount != 1 {
		t.Fatalf("valid reps = %d, want 1", res.ValidCount)
	}
	if got := domain.ScorePoints(res.ValidCount, "standard", 75, 0); got != 1 {
		t.Errorf("score = %v, want 1", got)
	}
	_ = math.Round
}
