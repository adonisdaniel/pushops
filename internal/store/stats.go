package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"

	"github.com/adonis/pushops/internal/domain"
)

// Leaderboard metric identifiers.
const (
	MetricReps    = "reps"
	MetricPoints  = "points"
	MetricPace    = "pace"
	MetricBestSet = "best_set"
	MetricStreak  = "streak"
)

// ValidMetric reports whether a metric name is supported.
func ValidMetric(m string) bool {
	switch m {
	case MetricReps, MetricPoints, MetricPace, MetricBestSet, MetricStreak:
		return true
	}
	return false
}

// Aggregate is the per-user roll-up of a period.
type Aggregate struct {
	UserID     int64
	Nickname   string
	PhotoURL   string
	Reps       int
	Points     float64
	Sets       int
	BestSet    int
	BestPoints float64
	Pace       float64
	WeightKg   float64
	Trust      int
	WeightAt   int64
}

const aggregateSelect = `SELECT u.id, u.nickname, u.photo_url, u.weight_kg, u.trust_level, u.weights_confirmed_at,
	COALESCE(SUM(w.reps_valid), 0) AS reps,
	COALESCE(SUM(w.points), 0) AS points,
	COUNT(w.id) AS sets,
	COALESCE(MAX(w.reps_valid), 0) AS best_set,
	COALESCE(MAX(w.points), 0) AS best_set_points,
	COALESCE(MAX(CASE WHEN w.reps_valid >= 3 THEN w.reps_valid * 60000.0 / NULLIF(w.duration_ms, 0) END), 0) AS pace
FROM users u
LEFT JOIN workouts w ON w.user_id = u.id AND w.started_at >= ? AND w.started_at <= ?`

// aggregateFor loads aggregates for an arbitrary set of users.
func (s *Store) aggregateFor(ctx context.Context, userIDs []int64, from, to int64) ([]Aggregate, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(userIDs))
	args := []any{from, to}
	for i, id := range userIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	q := aggregateSelect + ` WHERE u.id IN (` + joinPlaceholders(placeholders) + `) GROUP BY u.id`

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, wrap("store: aggregate", err)
	}
	defer rows.Close()
	out := []Aggregate{}
	for rows.Next() {
		var a Aggregate
		if err := rows.Scan(&a.UserID, &a.Nickname, &a.PhotoURL, &a.WeightKg, &a.Trust, &a.WeightAt,
			&a.Reps, &a.Points, &a.Sets, &a.BestSet, &a.BestPoints, &a.Pace); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// aggregateAll loads aggregates for every user above a trust level.
func (s *Store) aggregateAll(ctx context.Context, minTrust int, from, to int64, limit int) ([]Aggregate, error) {
	q := aggregateSelect + ` WHERE u.trust_level >= ? GROUP BY u.id ORDER BY reps DESC LIMIT ?`
	rows, err := s.db.QueryContext(ctx, q, from, to, minTrust, limit)
	if err != nil {
		return nil, wrap("store: aggregate all", err)
	}
	defer rows.Close()
	out := []Aggregate{}
	for rows.Next() {
		var a Aggregate
		if err := rows.Scan(&a.UserID, &a.Nickname, &a.PhotoURL, &a.WeightKg, &a.Trust, &a.WeightAt,
			&a.Reps, &a.Points, &a.Sets, &a.BestSet, &a.BestPoints, &a.Pace); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Summary builds the personal statistics of a user over a period.
func (s *Store) Summary(ctx context.Context, userID, from, to int64) (*domain.Summary, error) {
	aggs, err := s.aggregateFor(ctx, []int64{userID}, from, to)
	if err != nil {
		return nil, err
	}
	sum := &domain.Summary{}
	if len(aggs) > 0 {
		a := aggs[0]
		sum.ValidReps = a.Reps
		sum.TotalPoints = a.Points
		sum.Workouts = a.Sets
		sum.BestSet = a.BestSet
		sum.BestSetPoints = a.BestPoints
		sum.AvgPace = a.Pace
	}

	dates, err := s.ActiveDates(ctx, userID, from, to)
	if err != nil {
		return nil, err
	}
	sum.ActiveDays = len(dates)
	sum.Streak = domain.StreakDays(dates, time.Now())

	// Total reps (valid + invalid) and total time.
	var totalReps, totalDuration int
	err = s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(reps_total), 0), COALESCE(SUM(duration_ms), 0)
		 FROM workouts WHERE user_id = ? AND started_at >= ? AND started_at <= ?`,
		userID, from, to).Scan(&totalReps, &totalDuration)
	if err != nil {
		return nil, wrap("store: summary totals", err)
	}
	sum.TotalReps = totalReps
	sum.TotalDuration = int64(totalDuration)
	return sum, nil
}

// Timeseries returns the daily or weekly roll-up of a user.
func (s *Store) Timeseries(ctx context.Context, userID, from, to int64, bucket string) ([]domain.Bucket, error) {
	daily, err := s.DailyTotals(ctx, userID, from, to)
	if err != nil {
		return nil, err
	}
	if bucket == "week" || bucket == "month" {
		grouped := map[string]domain.Bucket{}
		for date, b := range daily {
			key := bucketKey(date, bucket)
			g := grouped[key]
			g.Date = key
			g.Reps += b.Reps
			g.Points += b.Points
			g.Sets += b.Sets
			grouped[key] = g
		}
		out := make([]domain.Bucket, 0, len(grouped))
		for _, b := range grouped {
			out = append(out, b)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
		return out, nil
	}
	out := make([]domain.Bucket, 0, len(daily))
	for _, b := range daily {
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	return out, nil
}

func bucketKey(date, bucket string) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	if bucket == "month" {
		return t.Format("2006-01")
	}
	// ISO week start (Monday).
	wd := int(t.Weekday())
	if wd == 0 {
		wd = 7
	}
	start := t.AddDate(0, 0, -(wd - 1))
	return start.Format("2006-01-02")
}

// LeaderboardOptions controls a ranking query.
type LeaderboardOptions struct {
	Metric      string
	From        int64
	To          int64
	Limit       int
	MinTrust    int
	OnlyUserIDs []int64
	ViewerID    int64
	// ExcludeStaleWeights drops users whose body weight has not been confirmed
	// recently. Used for the global points ranking.
	ExcludeStaleWeights bool
}

// Leaderboard computes a ranking for the given options.
func (s *Store) Leaderboard(ctx context.Context, opts LeaderboardOptions) ([]domain.LeaderboardEntry, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}

	var aggs []Aggregate
	var err error
	if len(opts.OnlyUserIDs) > 0 {
		aggs, err = s.aggregateFor(ctx, opts.OnlyUserIDs, opts.From, opts.To)
	} else {
		aggs, err = s.aggregateAll(ctx, opts.MinTrust, opts.From, opts.To, 1000)
	}
	if err != nil {
		return nil, err
	}

	streaks := map[int64]int{}
	if opts.Metric == MetricStreak {
		for _, a := range aggs {
			dates, dErr := s.ActiveDates(ctx, a.UserID, opts.From, opts.To)
			if dErr != nil {
				return nil, dErr
			}
			streaks[a.UserID] = domain.StreakDays(dates, time.Now())
		}
	}

	nowMs := Now()
	entries := make([]domain.LeaderboardEntry, 0, len(aggs))
	for _, a := range aggs {
		if opts.ExcludeStaleWeights && a.WeightAt > 0 && nowMs-a.WeightAt > 30*24*60*60*1000 {
			continue
		}
		e := domain.LeaderboardEntry{
			UserID:   a.UserID,
			Nickname: a.Nickname,
			PhotoURL: a.PhotoURL,
			Reps:     a.Reps,
			Points:   a.Points,
			Sets:     a.Sets,
			BestSet:  a.BestSet,
			Pace:     round1(a.Pace),
			Streak:   streaks[a.UserID],
			IsMe:     a.UserID == opts.ViewerID,
		}
		switch opts.Metric {
		case MetricPoints:
			e.Value = round1(a.Points)
		case MetricPace:
			e.Value = round1(a.Pace)
		case MetricBestSet:
			e.Value = float64(a.BestSet)
		case MetricStreak:
			e.Value = float64(streaks[a.UserID])
		default:
			e.Value = float64(a.Reps)
		}
		entries = append(entries, e)
	}

	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Value != entries[j].Value {
			return entries[i].Value > entries[j].Value
		}
		if entries[i].Reps != entries[j].Reps {
			return entries[i].Reps > entries[j].Reps
		}
		return entries[i].Nickname < entries[j].Nickname
	})
	if len(entries) > opts.Limit {
		entries = entries[:opts.Limit]
	}
	for i := range entries {
		entries[i].Rank = i + 1
	}
	return entries, nil
}

// GroupTotals summarises a group over a period.
type GroupTotals struct {
	TotalReps   int     `json:"totalReps"`
	TotalPoints float64 `json:"totalPoints"`
	Sets        int     `json:"sets"`
	Members     int     `json:"members"`
	ActiveDays  int     `json:"activeDays"`
	AvgPerDay   float64 `json:"avgPerDay"`
}

// GroupSummary computes the aggregate statistics of a group.
func (s *Store) GroupSummary(ctx context.Context, groupID, from, to int64) (*GroupTotals, error) {
	members, err := s.GroupMemberIDs(ctx, groupID)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return &GroupTotals{}, nil
	}
	aggs, err := s.aggregateFor(ctx, members, from, to)
	if err != nil {
		return nil, err
	}
	out := &GroupTotals{Members: len(members)}
	days := map[string]bool{}
	for _, a := range aggs {
		out.TotalReps += a.Reps
		out.TotalPoints += a.Points
		out.Sets += a.Sets
		dates, dErr := s.ActiveDates(ctx, a.UserID, from, to)
		if dErr != nil {
			return nil, dErr
		}
		for _, d := range dates {
			days[d] = true
		}
	}
	out.ActiveDays = len(days)
	if out.ActiveDays > 0 {
		out.AvgPerDay = round1(float64(out.TotalReps) / float64(out.ActiveDays))
	}
	return out, nil
}

// GroupDailySeries returns the group's total reps per day.
func (s *Store) GroupDailySeries(ctx context.Context, groupID, from, to int64) ([]domain.Bucket, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT w.local_date, SUM(w.reps_valid), SUM(w.points), COUNT(*)
		 FROM workouts w JOIN group_members m ON m.user_id = w.user_id AND m.group_id = ?
		 WHERE w.local_date != '' AND w.started_at >= ? AND w.started_at <= ?
		 GROUP BY w.local_date ORDER BY w.local_date`, groupID, from, to)
	if err != nil {
		return nil, wrap("store: group daily series", err)
	}
	defer rows.Close()
	out := []domain.Bucket{}
	for rows.Next() {
		var b domain.Bucket
		if err := rows.Scan(&b.Date, &b.Reps, &b.Points, &b.Sets); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// GroupMemberStats returns per-member stats inside a group.
func (s *Store) GroupMemberStats(ctx context.Context, groupID, from, to int64) ([]domain.LeaderboardEntry, error) {
	members, err := s.GroupMemberIDs(ctx, groupID)
	if err != nil {
		return nil, err
	}
	return s.Leaderboard(ctx, LeaderboardOptions{
		Metric:      MetricPoints,
		From:        from,
		To:          to,
		OnlyUserIDs: members,
		MinTrust:    0,
	})
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

func joinPlaceholders(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}

// Ensure the sql package is referenced even when only helpers are used.
var _ = sql.ErrNoRows
var _ = fmt.Sprintf
