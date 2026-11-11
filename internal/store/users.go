package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/adonis/pushops/internal/auth"
	"github.com/adonis/pushops/internal/domain"
)

// Now returns the current epoch milliseconds, overridable in tests.
var Now = func() int64 { return time.Now().UnixMilli() }

const userColumns = `id, tg_id, nickname, nickname_custom, tg_username, first_name, photo_url,
	weight_kg, weight_since, weights_confirmed_at, trust_level, created_at`

func scanUser(row interface{ Scan(...any) error }) (*domain.User, error) {
	var u domain.User
	var custom int
	err := row.Scan(&u.ID, &u.TgID, &u.Nickname, &custom, &u.TgUsername, &u.FirstName, &u.PhotoURL,
		&u.WeightKg, &u.WeightSince, &u.WeightsConfirmedAt, &u.TrustLevel, &u.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.NicknameCustom = custom == 1
	return &u, nil
}

// GetUserByTgID loads a user by their Telegram id.
func (s *Store) GetUserByTgID(ctx context.Context, tgID int64) (*domain.User, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE tg_id = ?`, tgID)
	return scanUser(row)
}

// GetUser loads a user by internal id.
func (s *Store) GetUser(ctx context.Context, id int64) (*domain.User, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE id = ?`, id)
	return scanUser(row)
}

// GetUserByNickname loads a user by nickname (case-insensitive).
func (s *Store) GetUserByNickname(ctx context.Context, nickname string) (*domain.User, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE nickname = ? COLLATE NOCASE`, nickname)
	return scanUser(row)
}

// GetUserByTgUsername loads a user by their Telegram @username.
func (s *Store) GetUserByTgUsername(ctx context.Context, username string) (*domain.User, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE tg_username = ? AND tg_username != '' LIMIT 1`, username)
	return scanUser(row)
}

// FindUser resolves a friend request target by nickname or Telegram username.
func (s *Store) FindUser(ctx context.Context, query string) (*domain.User, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, ErrNotFound
	}
	if u, err := s.GetUserByNickname(ctx, query); err == nil {
		return u, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if u, err := s.GetUserByTgUsername(ctx, strings.TrimPrefix(query, "@")); err == nil {
		return u, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	return nil, ErrNotFound
}

// EnsureUser returns the user for a Telegram identity, creating it with a random
// nickname when it does not exist yet.
func (s *Store) EnsureUser(ctx context.Context, tg *auth.TelegramUser, rnd *rand.Rand) (*domain.User, bool, error) {
	if tg == nil {
		return nil, false, fmt.Errorf("store: nil telegram user")
	}
	if rnd == nil {
		rnd = rand.New(rand.NewSource(time.Now().UnixNano()))
	}
	existing, err := s.GetUserByTgID(ctx, tg.ID)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}

	now := Now()
	nickname, err := s.allocateNickname(ctx, rnd)
	if err != nil {
		return nil, false, err
	}

	res, err := s.db.ExecContext(ctx, `INSERT INTO users
		(tg_id, nickname, nickname_custom, tg_username, first_name, photo_url,
		 weight_kg, weight_since, weights_confirmed_at, trust_level, created_at)
		VALUES (?, ?, 0, ?, ?, ?, 70, ?, ?, 0, ?)`,
		tg.ID, nickname, tg.Username, tg.DisplayName(), tg.PhotoURL, now, now, now)
	if err != nil {
		if isUniqueViolation(err) {
			// Lost a race against a concurrent signup; re-read the row.
			u, getErr := s.GetUserByTgID(ctx, tg.ID)
			if getErr == nil {
				return u, false, nil
			}
		}
		return nil, false, wrap("store: insert user", err)
	}
	id, _ := res.LastInsertId()
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return nil, false, err
	}
	return user, true, nil
}

// allocateNickname picks a free random nickname, falling back to a numeric suffix.
func (s *Store) allocateNickname(ctx context.Context, rnd *rand.Rand) (string, error) {
	for i := 0; i < 25; i++ {
		candidate := domain.RandomNickname(rnd)
		exists, err := s.nicknameExists(ctx, candidate)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	for i := 0; i < 40; i++ {
		candidate := domain.RandomNicknameWithSuffix(rnd)
		exists, err := s.nicknameExists(ctx, candidate)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("store: could not allocate a nickname")
}

func (s *Store) nicknameExists(ctx context.Context, nickname string) (bool, error) {
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM users WHERE nickname = ? COLLATE NOCASE LIMIT 1`, nickname).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, wrap("store: check nickname", err)
	}
	return true, nil
}

// UpdateNickname changes the public handle, enforcing global uniqueness.
func (s *Store) UpdateNickname(ctx context.Context, userID int64, nickname string) error {
	nickname = strings.TrimSpace(nickname)
	if err := domain.ValidateNickname(nickname); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE users SET nickname = ?, nickname_custom = 1 WHERE id = ?`, nickname, userID)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("%w: ese nickname ya está en uso", ErrConflict)
		}
		return wrap("store: update nickname", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateWeight records a new body weight and versions it.
func (s *Store) UpdateWeight(ctx context.Context, userID int64, weightKg float64) error {
	now := Now()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO user_weights (user_id, weight_kg, effective_from) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, effective_from) DO UPDATE SET weight_kg = excluded.weight_kg`,
		userID, weightKg, now); err != nil {
		return wrap("store: insert weight", err)
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE users SET weight_kg = ?, weight_since = ?, weights_confirmed_at = ? WHERE id = ?`,
		weightKg, now, now, userID); err != nil {
		return wrap("store: update weight", err)
	}
	return nil
}

// WeightAt returns the body weight that was in effect at the given timestamp.
func (s *Store) WeightAt(ctx context.Context, userID, ts int64) (float64, error) {
	var w float64
	err := s.db.QueryRowContext(ctx,
		`SELECT weight_kg FROM user_weights WHERE user_id = ? AND effective_from <= ?
		 ORDER BY effective_from DESC LIMIT 1`, userID, ts).Scan(&w)
	if errors.Is(err, sql.ErrNoRows) {
		u, uErr := s.GetUser(ctx, userID)
		if uErr != nil {
			return 70, uErr
		}
		return u.WeightKg, nil
	}
	if err != nil {
		return 70, wrap("store: weight at", err)
	}
	return w, nil
}

// WeightHistory lists the recorded weights of a user, newest first.
func (s *Store) WeightHistory(ctx context.Context, userID int64, limit int) ([]domain.WeightEntry, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT weight_kg, effective_from FROM user_weights WHERE user_id = ?
		 ORDER BY effective_from DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, wrap("store: weight history", err)
	}
	defer rows.Close()
	out := []domain.WeightEntry{}
	for rows.Next() {
		var e domain.WeightEntry
		if err := rows.Scan(&e.WeightKg, &e.EffectiveFrom); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// BumpTrustLevel raises the trust level of a user once the threshold is reached.
func (s *Store) BumpTrustLevel(ctx context.Context, userID int64, verifiedSets int) error {
	level := 0
	switch {
	case verifiedSets >= 50:
		level = 3
	case verifiedSets >= 10:
		level = 2
	case verifiedSets >= 3:
		level = 1
	}
	if level == 0 {
		return nil
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET trust_level = ? WHERE id = ? AND trust_level < ?`, level, userID, level)
	return wrap("store: bump trust", err)
}

// SearchUsers finds users by nickname prefix, for friend search.
func (s *Store) SearchUsers(ctx context.Context, query string, limit int) ([]domain.User, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+userColumns+` FROM users
		 WHERE nickname LIKE ? COLLATE NOCASE OR tg_username LIKE ? COLLATE NOCASE
		 ORDER BY nickname LIMIT ?`, "%"+query+"%", "%"+strings.TrimPrefix(query, "@")+"%", limit)
	if err != nil {
		return nil, wrap("store: search users", err)
	}
	defer rows.Close()
	out := []domain.User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}
