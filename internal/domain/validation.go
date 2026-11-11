package domain

import "time"

// Auth limits used by the anti-cheat plausibility checks.
const (
	MinRepDurationMs  = 900
	MaxRepDurationMs  = 15000
	MaxRepsPerWorkout = 500
	MinAvgConfidence  = 0.50
	// MaxWorkoutDurationMs bounds a single session (3 hours is already absurd).
	MaxWorkoutDurationMs = 3 * 60 * 60 * 1000
)

// RepInput is one repetition as reported by the client.
type RepInput struct {
	TMs        int64   `json:"tMs"`
	DurationMs int64   `json:"durationMs"`
	FillMax    float64 `json:"fillMax"`
	ElbowMin   float64 `json:"elbowMin"`
	OK         bool    `json:"ok"`
	Conf       float64 `json:"conf"`
}

// WorkoutInput is the payload posted by the client when finishing a set.
type WorkoutInput struct {
	Variant   string         `json:"variant"`
	Mode      string         `json:"mode"`
	StartedAt int64          `json:"startedAt"`
	EndedAt   int64          `json:"endedAt"`
	Reps      []RepInput     `json:"reps"`
	Meta      map[string]any `json:"meta"`
}

// ValidationResult reports what the server accepted and why the rest was rejected.
type ValidationResult struct {
	Reps         []RepInput
	ValidCount   int
	InvalidCount int
	AvgConf      float64
	DurationMs   int64
	AvgRepMs     int64
	BestRepMs    int64
	Reason       string
}

// ValidateWorkout applies server-side plausibility rules to a reported set.
// The client is never trusted for the repetition count or the score.
func ValidateWorkout(in *WorkoutInput) ValidationResult {
	res := ValidationResult{}

	if in.StartedAt <= 0 || in.EndedAt <= 0 || in.EndedAt < in.StartedAt {
		res.Reason = "invalid timestamps"
		return res
	}
	duration := in.EndedAt - in.StartedAt
	if duration > MaxWorkoutDurationMs {
		res.Reason = "workout too long"
		return res
	}
	res.DurationMs = duration

	if len(in.Reps) > MaxRepsPerWorkout {
		in.Reps = in.Reps[:MaxRepsPerWorkout]
	}

	var confSum float64
	var confN int
	var totalRepMs int64
	var best int64

	for i := range in.Reps {
		r := in.Reps[i]
		confSum += r.Conf
		confN++

		// A repetition that lasted less or more than a humanly possible one is
		// never valid, no matter what the client claims.
		ms := r.DurationMs
		if ms < 0 {
			ms = 0
		}
		if r.OK && (ms < MinRepDurationMs || ms > MaxRepDurationMs) {
			r.OK = false
			in.Reps[i] = r
		}

		if r.OK {
			res.ValidCount++
			totalRepMs += ms
			if ms > best {
				best = ms
			}
		} else {
			res.InvalidCount++
		}
	}
	if confN > 0 {
		res.AvgConf = confSum / float64(confN)
	}
	res.AvgRepMs = 0
	if res.ValidCount > 0 {
		res.AvgRepMs = totalRepMs / int64(res.ValidCount)
	}
	res.BestRepMs = best

	// The set must be long enough for the number of valid reps it claims.
	if res.ValidCount > 0 {
		minNeeded := int64(res.ValidCount) * MinRepDurationMs
		if duration < minNeeded {
			res.Reason = "workout shorter than the reported repetitions require"
			res.ValidCount = 0
			res.InvalidCount = len(in.Reps)
		}
		if res.AvgConf > 0 && res.AvgConf < MinAvgConfidence {
			res.Reason = "detection confidence too low"
			res.ValidCount = 0
			res.InvalidCount = len(in.Reps)
		}
	}
	res.Reps = in.Reps
	return res
}

// StreakDays counts consecutive days (ending today or yesterday) with at least one
// workout. days is the set of distinct local dates, formatted as YYYY-MM-DD.
func StreakDays(days []string, now time.Time) int {
	if len(days) == 0 {
		return 0
	}
	set := make(map[string]bool, len(days))
	for _, d := range days {
		set[d] = true
	}
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")

	cursor := today
	if !set[cursor] {
		if !set[yesterday] {
			return 0
		}
		cursor = yesterday
	}
	streak := 0
	for {
		if !set[cursor] {
			break
		}
		streak++
		t, err := time.Parse("2006-01-02", cursor)
		if err != nil {
			break
		}
		cursor = t.AddDate(0, 0, -1).Format("2006-01-02")
	}
	return streak
}
