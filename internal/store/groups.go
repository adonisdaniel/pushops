package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/adonis/pushops/internal/domain"
)

const groupAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// CreateGroup creates a group owned by the given user and returns it.
func (s *Store) CreateGroup(ctx context.Context, ownerID int64, name string, isPrivate bool) (*domain.Group, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("store: group name is required")
	}
	if len([]rune(name)) > 40 {
		return nil, fmt.Errorf("store: group name is too long")
	}

	code, err := s.allocateInviteCode(ctx)
	if err != nil {
		return nil, err
	}
	now := Now()
	priv := 0
	if isPrivate {
		priv = 1
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO groups (name, owner_id, invite_code, is_private, created_at) VALUES (?, ?, ?, ?, ?)`,
		name, ownerID, code, priv, now)
	if err != nil {
		return nil, wrap("store: insert group", err)
	}
	id, _ := res.LastInsertId()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
		id, ownerID, now); err != nil {
		return nil, wrap("store: insert owner membership", err)
	}
	return s.GetGroup(ctx, id)
}

func (s *Store) allocateInviteCode(ctx context.Context) (string, error) {
	for i := 0; i < 20; i++ {
		code := randomCode(6)
		exists, err := s.groupCodeExists(ctx, code)
		if err != nil {
			return "", err
		}
		if !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("store: could not allocate an invite code")
}

func randomCode(n int) string {
	out := make([]byte, n)
	max := big.NewInt(int64(len(groupAlphabet)))
	for i := range out {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			return fmt.Sprintf("%06d", Now()%1000000)
		}
		out[i] = groupAlphabet[v.Int64()]
	}
	return string(out)
}

func (s *Store) groupCodeExists(ctx context.Context, code string) (bool, error) {
	var one int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM groups WHERE invite_code = ? LIMIT 1`, code).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, wrap("store: check invite code", err)
	}
	return true, nil
}

// JoinGroup adds a user to a group using an invite code.
func (s *Store) JoinGroup(ctx context.Context, userID int64, code string) (*domain.Group, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, fmt.Errorf("store: invite code is required")
	}
	row := s.db.QueryRowContext(ctx,
		`SELECT id, name, owner_id, invite_code, is_private, created_at FROM groups WHERE invite_code = ?`, code)
	var g domain.Group
	var priv int
	if err := row.Scan(&g.ID, &g.Name, &g.OwnerID, &g.InviteCode, &priv, &g.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, wrap("store: find group by code", err)
	}
	g.IsPrivate = priv == 1

	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)
		 ON CONFLICT(group_id, user_id) DO NOTHING`, g.ID, userID, Now()); err != nil {
		return nil, wrap("store: join group", err)
	}
	return s.GetGroup(ctx, g.ID)
}

// GetGroup loads a group with its member count.
func (s *Store) GetGroup(ctx context.Context, id int64) (*domain.Group, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT g.id, g.name, g.owner_id, g.invite_code, g.is_private, g.created_at,
		        (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id)
		 FROM groups g WHERE g.id = ?`, id)
	var g domain.Group
	var priv int
	if err := row.Scan(&g.ID, &g.Name, &g.OwnerID, &g.InviteCode, &priv, &g.CreatedAt, &g.MemberCount); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, wrap("store: get group", err)
	}
	g.IsPrivate = priv == 1
	return &g, nil
}

// ListGroups returns the groups a user belongs to.
func (s *Store) ListGroups(ctx context.Context, userID int64) ([]domain.Group, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT g.id, g.name, g.owner_id, g.invite_code, g.is_private, g.created_at,
		        (SELECT COUNT(*) FROM group_members m2 WHERE m2.group_id = g.id), m.role
		 FROM group_members m JOIN groups g ON g.id = m.group_id
		 WHERE m.user_id = ? ORDER BY m.joined_at DESC`, userID)
	if err != nil {
		return nil, wrap("store: list groups", err)
	}
	defer rows.Close()
	out := []domain.Group{}
	for rows.Next() {
		var g domain.Group
		var priv int
		if err := rows.Scan(&g.ID, &g.Name, &g.OwnerID, &g.InviteCode, &priv, &g.CreatedAt, &g.MemberCount, &g.Role); err != nil {
			return nil, err
		}
		g.IsPrivate = priv == 1
		out = append(out, g)
	}
	return out, rows.Err()
}

// Membership returns the role of a user in a group, or "" when not a member.
func (s *Store) Membership(ctx context.Context, groupID, userID int64) (string, error) {
	var role string
	err := s.db.QueryRowContext(ctx,
		`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", wrap("store: membership", err)
	}
	return role, nil
}

// GroupMemberIDs returns the ids of the members of a group.
func (s *Store) GroupMemberIDs(ctx context.Context, groupID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT user_id FROM group_members WHERE group_id = ?`, groupID)
	if err != nil {
		return nil, wrap("store: group member ids", err)
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

// LeaveGroup removes a member from a group.
func (s *Store) LeaveGroup(ctx context.Context, groupID, userID int64) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, userID)
	if err != nil {
		return wrap("store: leave group", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteGroup removes a group and its memberships.
func (s *Store) DeleteGroup(ctx context.Context, groupID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return wrap("store: begin delete group", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_members WHERE group_id = ?`, groupID); err != nil {
		return wrap("store: delete members", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM groups WHERE id = ?`, groupID); err != nil {
		return wrap("store: delete group", err)
	}
	return wrap("store: commit delete group", tx.Commit())
}
