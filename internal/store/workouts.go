package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/adonis/pushops/internal/domain"
)

const workoutColumns = `id, user_id, client_id, variant, mode, started_at, ended_at, local_date,
	duration_ms, reps_total, reps_valid, avg_rep_ms, best_rep_ms, points, meta, created_at`

func scanWorkout(row interface{ Scan(...any) error }) (*domain.Workout, error) {
	var w domain.Workout
	err := row.Scan(&w.ID, &w.UserID, &w.ClientID, &w.Variant, &w.Mode, &w.StartedAt, &w.EndedAt, &w.LocalDate,
		&w.DurationMs, &w.RepsTotal, &w.RepsValid, &w.AvgRepMs, &w.BestRepMs, &w.Points, &w.Meta, &w.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &w, nil
}

// CreateWorkout stores a set together with its repetitions.
// When the client retries an upload with the same client id, the existing set
// is returned instead of creating a duplicate.
func (s *Store) CreateWorkout(ctx context.Context, w *domain.Workout, reps []domain.RepInput) (int64, error) {
	if w.ClientID != "" {
		var existing int64
		err := s.db.QueryRowContext(ctx,
			`SELECT id FROM workouts WHERE user_id = ? AND client_id = ?`, w.UserID, w.ClientID).Scan(&existing)
		if err == nil {
			return existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, wrap("store: lookup client id", err)
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, wrap("store: begin workout tx", err)
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `INSERT INTO workouts
		(user_id, client_id, variant, mode, started_at, ended_at, local_date, duration_ms,
		 reps_total, reps_valid, avg_rep_ms, best_rep_ms, points, meta, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		w.UserID, w.ClientID, w.Variant, w.Mode, w.StartedAt, w.EndedAt, w.LocalDate, w.DurationMs,
		w.RepsTotal, w.RepsValid, w.AvgRepMs, w.BestRepMs, w.Points, w.Meta, Now())
	if err != nil {
		return 0, wrap("store: insert workout", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	for i, r := range reps {
		ok := 0
		if r.OK {
			ok = 1
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO reps
			(workout_id, idx, t_ms, duration_ms, fill_max, elbow_min, ok, conf)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, i, r.TMs, r.DurationMs, r.FillMax, r.ElbowMin, ok, r.Conf); err != nil {
			return 0, wrap("store: insert rep", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, wrap("store: commit workout", err)
	}
	return id, nil
}

// ListWorkouts returns the most recent sets of a user.
func (s *Store) ListWorkouts(ctx context.Context, userID int64, limit, offset int) ([]domain.Workout, error) {
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+workoutColumns+` FROM workouts WHERE user_id = ?
		 ORDER BY started_at DESC LIMIT ? OFFSET ?`, userID, limit, offset)
	if err != nil {
		return nil, wrap("store: list workouts", err)
	}
	defer rows.Close()
	out := []domain.Workout{}
	for rows.Next() {
		w, err := scanWorkout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

// GetWorkout loads a single set.
func (s *Store) GetWorkout(ctx context.Context, id int64) (*domain.Workout, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+workoutColumns+` FROM workouts WHERE id = ?`, id)
	return scanWorkout(row)
}

// GetWorkoutReps loads the repetitions of a set.
func (s *Store) GetWorkoutReps(ctx context.Context, workoutID int64) ([]domain.RepInput, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT t_ms, duration_ms, fill_max, elbow_min, ok, conf FROM reps
		 WHERE workout_id = ? ORDER BY idx`, workoutID)
	if err != nil {
		return nil, wrap("store: get reps", err)
	}
	defer rows.Close()
	out := []domain.RepInput{}
	for rows.Next() {
		var r domain.RepInput
		var ok int
		if err := rows.Scan(&r.TMs, &r.DurationMs, &r.FillMax, &r.ElbowMin, &ok, &r.Conf); err != nil {
			return nil, err
		}
		r.OK = ok == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

// CountWorkouts returns how many sets a user has recorded.
func (s *Store) CountWorkouts(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM workouts WHERE user_id = ?`, userID).Scan(&n)
	if err != nil {
		return 0, wrap("store: count workouts", err)
	}
	return n, nil
}

// ActiveDates returns the distinct local dates on which a user trained.
func (s *Store) ActiveDates(ctx context.Context, userID int64, from, to int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT DISTINCT local_date FROM workouts
		 WHERE user_id = ? AND local_date != '' AND started_at >= ? AND started_at <= ?
		 ORDER BY local_date`, userID, from, to)
	if err != nil {
		return nil, wrap("store: active dates", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DailyTotals aggregates reps and points per local date.
func (s *Store) DailyTotals(ctx context.Context, userID int64, from, to int64) (map[string]domain.Bucket, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT local_date, SUM(reps_valid), SUM(points), COUNT(*)
		 FROM workouts WHERE user_id = ? AND local_date != '' AND started_at >= ? AND started_at <= ?
		 GROUP BY local_date`, userID, from, to)
	if err != nil {
		return nil, wrap("store: daily totals", err)
	}
	defer rows.Close()
	out := map[string]domain.Bucket{}
	for rows.Next() {
		var b domain.Bucket
		if err := rows.Scan(&b.Date, &b.Reps, &b.Points, &b.Sets); err != nil {
			return nil, err
		}
		out[b.Date] = b
	}
	return out, rows.Err()
}

// DayStart returns the epoch milliseconds of the beginning of a local date.
func DayStart(date string) (int64, error) {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return 0, err
	}
	return t.UnixMilli(), nil
}
