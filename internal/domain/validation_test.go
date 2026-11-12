package domain

import "testing"

func TestValidateWorkoutRejectsImpossibleReps(t *testing.T) {
	in := &WorkoutInput{
		StartedAt: 1_000_000,
		EndedAt:   1_060_000,
		Reps: []RepInput{
			{TMs: 0, DurationMs: 2000, FillMax: 0.85, OK: true, Conf: 0.9},
			{TMs: 3000, DurationMs: 2100, FillMax: 0.83, OK: true, Conf: 0.9},
			{TMs: 6000, DurationMs: 100, FillMax: 0.9, OK: true, Conf: 0.9},
		},
	}
	res := ValidateWorkout(in)
	if res.ValidCount != 2 {
		t.Errorf("valid reps = %d, want 2", res.ValidCount)
	}
	if res.InvalidCount != 1 {
		t.Errorf("invalid reps = %d, want 1", res.InvalidCount)
	}
	if res.Reason != "" {
		t.Errorf("unexpected rejection reason %q", res.Reason)
	}
	// The reported repetitions must be updated so the stored data matches.
	if in.Reps[2].OK {
		t.Error("the impossibly fast repetition should have been marked invalid")
	}
}

func TestValidateWorkoutDegradesShortSessions(t *testing.T) {
	// Ten repetitions cannot fit in two seconds. The set is not thrown away:
	// the surplus is invalidated and the ones that fit are kept.
	reps := make([]RepInput, 10)
	for i := range reps {
		reps[i] = RepInput{TMs: int64(i * 200), DurationMs: 1000, FillMax: 0.9, OK: true, Conf: 0.9}
	}
	in := &WorkoutInput{
		StartedAt: 1,
		EndedAt:   2001,
		Reps:      reps,
	}
	res := ValidateWorkout(in)
	if res.Reason != "" {
		t.Fatalf("the set must not be rejected: %q", res.Reason)
	}
	// Two seconds fit two repetitions of one second each.
	if res.ValidCount != 2 {
		t.Errorf("valid reps = %d, want 2", res.ValidCount)
	}
	if res.InvalidCount != 8 {
		t.Errorf("invalid reps = %d, want 8", res.InvalidCount)
	}
}

func TestValidateWorkoutRejectsLowConfidence(t *testing.T) {
	in := &WorkoutInput{
		StartedAt: 1,
		EndedAt:   60_001,
		Reps: []RepInput{
			{TMs: 0, DurationMs: 2000, FillMax: 0.9, OK: true, Conf: 0.2},
		},
	}
	res := ValidateWorkout(in)
	if res.ValidCount != 0 {
		t.Errorf("valid reps = %d, want 0", res.ValidCount)
	}
}

func TestValidateWorkoutRejectsBrokenTimestamps(t *testing.T) {
	in := &WorkoutInput{StartedAt: 5000, EndedAt: 1000}
	if res := ValidateWorkout(in); res.Reason == "" {
		t.Error("expected a rejection for inverted timestamps")
	}
	in = &WorkoutInput{StartedAt: 0, EndedAt: 0}
	if res := ValidateWorkout(in); res.Reason == "" {
		t.Error("expected a rejection for missing timestamps")
	}
}

func TestValidateWorkoutCapsRepCount(t *testing.T) {
	reps := make([]RepInput, MaxRepsPerWorkout+50)
	for i := range reps {
		reps[i] = RepInput{DurationMs: 1000, FillMax: 0.8, OK: true, Conf: 0.9}
	}
	in := &WorkoutInput{StartedAt: 1, EndedAt: 5_400_000, Reps: reps}
	res := ValidateWorkout(in)
	if len(in.Reps) > MaxRepsPerWorkout {
		t.Errorf("rep count = %d, want at most %d", len(in.Reps), MaxRepsPerWorkout)
	}
	if res.ValidCount > MaxRepsPerWorkout {
		t.Errorf("valid count = %d, want at most %d", res.ValidCount, MaxRepsPerWorkout)
	}
}

func TestStreakDays(t *testing.T) {
	now := mustDate("2026-03-10")
	cases := []struct {
		name string
		days []string
		want int
	}{
		{"empty", nil, 0},
		{"today only", []string{"2026-03-10"}, 1},
		{"three in a row", []string{"2026-03-08", "2026-03-09", "2026-03-10"}, 3},
		{"gap breaks it", []string{"2026-03-07", "2026-03-10"}, 1},
		{"yesterday counts", []string{"2026-03-09", "2026-03-10"}, 2},
		{"old streak is dead", []string{"2026-01-01", "2026-01-02"}, 0},
	}
	for _, c := range cases {
		if got := StreakDays(c.days, now); got != c.want {
			t.Errorf("%s: streak = %d, want %d", c.name, got, c.want)
		}
	}
}
