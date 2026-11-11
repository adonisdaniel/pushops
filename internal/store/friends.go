package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/adonis/pushops/internal/domain"
)

// Friendship status values.
const (
	StatusPending  = "pending"
	StatusAccepted = "accepted"
	StatusDeclined = "declined"
)

// RequestFriend creates or refreshes a friendship request from requester to target.
func (s *Store) RequestFriend(ctx context.Context, requesterID, targetID int64) (*domain.Friendship, error) {
	if requesterID == targetID {
		return nil, fmt.Errorf("store: cannot befriend yourself")
	}
	if _, err := s.GetUser(ctx, targetID); err != nil {
		return nil, err
	}

	now := Now()
	existing, err := s.findFriendship(ctx, requesterID, targetID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if existing != nil {
		switch existing.Status {
		case StatusAccepted:
			return nil, fmt.Errorf("%w: ya sois amigos", ErrConflict)
		case StatusPending:
			if existing.RequesterID == requesterID {
				return nil, fmt.Errorf("%w: ya has enviado la solicitud", ErrConflict)
			}
			return nil, fmt.Errorf("%w: ya hay una solicitud pendiente", ErrConflict)
		}
		// Declined: let them try again.
		_, err = s.db.ExecContext(ctx,
			`UPDATE friendships SET requester_id = ?, addressee_id = ?, status = ?, created_at = ?, responded_at = 0
			 WHERE id = ?`, requesterID, targetID, StatusPending, now, existing.ID)
		if err != nil {
			return nil, wrap("store: refresh friendship", err)
		}
		return s.getFriendship(ctx, existing.ID)
	}

	res, err := s.db.ExecContext(ctx,
		`INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?)`,
		requesterID, targetID, StatusPending, now)
	if err != nil {
		return nil, wrap("store: insert friendship", err)
	}
	id, _ := res.LastInsertId()
	return s.getFriendship(ctx, id)
}

func (s *Store) findFriendship(ctx context.Context, a, b int64) (*domain.Friendship, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, requester_id, addressee_id, status, created_at, responded_at
		 FROM friendships WHERE MIN(requester_id, addressee_id) = MIN(?, ?) AND MAX(requester_id, addressee_id) = MAX(?, ?)`,
		a, b, a, b)
	var f domain.Friendship
	err := row.Scan(&f.ID, &f.RequesterID, &f.AddresseeID, &f.Status, &f.CreatedAt, &f.RespondedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, wrap("store: find friendship", err)
	}
	return &f, nil
}

func (s *Store) getFriendship(ctx context.Context, id int64) (*domain.Friendship, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, requester_id, addressee_id, status, created_at, responded_at
		 FROM friendships WHERE id = ?`, id)
	var f domain.Friendship
	err := row.Scan(&f.ID, &f.RequesterID, &f.AddresseeID, &f.Status, &f.CreatedAt, &f.RespondedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, wrap("store: get friendship", err)
	}
	return &f, nil
}

// RespondFriend accepts or declines a pending request addressed to userID.
func (s *Store) RespondFriend(ctx context.Context, userID, friendshipID int64, accept bool) error {
	f, err := s.getFriendship(ctx, friendshipID)
	if err != nil {
		return err
	}
	if f.AddresseeID != userID {
		return fmt.Errorf("%w: esta solicitud no es para ti", ErrConflict)
	}
	if f.Status != StatusPending {
		return fmt.Errorf("%w: la solicitud ya fue respondida", ErrConflict)
	}
	status := StatusDeclined
	if accept {
		status = StatusAccepted
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE friendships SET status = ?, responded_at = ? WHERE id = ?`, status, Now(), friendshipID)
	return wrap("store: respond friendship", err)
}

// RemoveFriend deletes the friendship between two users.
func (s *Store) RemoveFriend(ctx context.Context, userID, friendID int64) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM friendships WHERE MIN(requester_id, addressee_id) = MIN(?, ?) AND MAX(requester_id, addressee_id) = MAX(?, ?)`,
		userID, friendID, userID, friendID)
	if err != nil {
		return wrap("store: remove friendship", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListFriends returns accepted friends and pending requests for a user.
func (s *Store) ListFriends(ctx context.Context, userID int64) (friends []domain.Friendship, incoming []domain.Friendship, err error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_at, f.responded_at,
		        u.nickname, u.tg_username, u.photo_url
		 FROM friendships f
		 JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
		 WHERE (f.requester_id = ? OR f.addressee_id = ?)
		 ORDER BY f.created_at DESC`, userID, userID, userID)
	if err != nil {
		return nil, nil, wrap("store: list friends", err)
	}
	defer rows.Close()

	for rows.Next() {
		var f domain.Friendship
		if err := rows.Scan(&f.ID, &f.RequesterID, &f.AddresseeID, &f.Status, &f.CreatedAt, &f.RespondedAt,
			&f.Nickname, &f.TgUsername, &f.PhotoURL); err != nil {
			return nil, nil, err
		}
		switch f.Status {
		case StatusAccepted:
			friends = append(friends, f)
		case StatusPending:
			if f.AddresseeID == userID {
				incoming = append(incoming, f)
			}
		}
	}
	return friends, incoming, rows.Err()
}

// FriendIDs returns the ids of a user's accepted friends.
func (s *Store) FriendIDs(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
		 FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = ?`,
		userID, userID, userID, StatusAccepted)
	if err != nil {
		return nil, wrap("store: friend ids", err)
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
