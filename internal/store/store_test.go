package store

import (
	"context"
	"testing"

	"github.com/adonis/pushops/internal/auth"
	"github.com/adonis/pushops/internal/domain"
)

// newTestStore opens an in-memory database with the schema applied.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := openTestDB()
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(db)
}

func TestEnsureUserAssignsAUniqueNickname(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	first, isNew, err := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1, FirstName: "Ada"}, nil)
	if err != nil {
		t.Fatalf("EnsureUser: %v", err)
	}
	if !isNew {
		t.Error("the first call should create the user")
	}
	if first.Nickname == "" {
		t.Error("the user should get a nickname")
	}

	second, isNew, err := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1, FirstName: "Ada"}, nil)
	if err != nil {
		t.Fatalf("EnsureUser (second): %v", err)
	}
	if isNew {
		t.Error("the second call should reuse the user")
	}
	if second.ID != first.ID || second.Nickname != first.Nickname {
		t.Errorf("the user changed between calls: %+v vs %+v", first, second)
	}
}

func TestNicknamesAreUniqueAcrossUsers(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	seen := map[string]bool{}
	for i := int64(1); i <= 25; i++ {
		u, _, err := s.EnsureUser(ctx, &auth.TelegramUser{ID: i}, nil)
		if err != nil {
			t.Fatalf("EnsureUser(%d): %v", i, err)
		}
		if seen[u.Nickname] {
			t.Fatalf("duplicate nickname %q at user %d", u.Nickname, i)
		}
		seen[u.Nickname] = true
	}
}

func TestUpdateNicknameEnforcesUniqueness(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	a, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1}, nil)
	b, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 2}, nil)

	if err := s.UpdateNickname(ctx, a.ID, "Puma Unico"); err != nil {
		t.Fatalf("UpdateNickname: %v", err)
	}
	if err := s.UpdateNickname(ctx, b.ID, "puma unico"); err == nil {
		t.Error("expected a case-insensitive duplicate nickname to be rejected")
	}
}

func TestWeightIsVersioned(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1}, nil)
	if err := s.UpdateWeight(ctx, u.ID, 70); err != nil {
		t.Fatalf("UpdateWeight: %v", err)
	}
	first := Now()

	// Move the clock forward so the second weight gets a later effective date.
	Now = func() int64 { return first + 86400000 }
	defer func() { Now = func() int64 { return first } }()

	if err := s.UpdateWeight(ctx, u.ID, 85); err != nil {
		t.Fatalf("UpdateWeight: %v", err)
	}

	atOld, err := s.WeightAt(ctx, u.ID, first)
	if err != nil {
		t.Fatalf("WeightAt: %v", err)
	}
	if atOld != 70 {
		t.Errorf("weight at the first timestamp = %v, want 70", atOld)
	}
	atNew, err := s.WeightAt(ctx, u.ID, first+86400000)
	if err != nil {
		t.Fatalf("WeightAt: %v", err)
	}
	if atNew != 85 {
		t.Errorf("weight at the second timestamp = %v, want 85", atNew)
	}
}

func TestCreateWorkoutIsIdempotentOnClientID(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1}, nil)
	workout := &domain.Workout{
		UserID:    u.ID,
		ClientID:  "client-1",
		Variant:   "standard",
		Mode:      "suelo",
		StartedAt: Now(),
		EndedAt:   Now() + 60000,
		LocalDate: "2026-03-10",
		Points:    12.5,
	}

	id1, err := s.CreateWorkout(ctx, workout, nil)
	if err != nil {
		t.Fatalf("CreateWorkout: %v", err)
	}
	id2, err := s.CreateWorkout(ctx, workout, nil)
	if err != nil {
		t.Fatalf("CreateWorkout (retry): %v", err)
	}
	if id1 != id2 {
		t.Errorf("the retry created a second workout: %d vs %d", id1, id2)
	}

	count, err := s.CountWorkouts(ctx, u.ID)
	if err != nil {
		t.Fatalf("CountWorkouts: %v", err)
	}
	if count != 1 {
		t.Errorf("workout count = %d, want 1", count)
	}
}

func TestFriendshipFlow(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	a, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1}, nil)
	b, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 2}, nil)

	if _, err := s.RequestFriend(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("RequestFriend: %v", err)
	}
	if _, err := s.RequestFriend(ctx, a.ID, b.ID); err == nil {
		t.Error("expected a duplicate request to be rejected")
	}

	friends, incoming, err := s.ListFriends(ctx, b.ID)
	if err != nil {
		t.Fatalf("ListFriends: %v", err)
	}
	if len(friends) != 0 {
		t.Errorf("the request should not be accepted yet, got %d friends", len(friends))
	}
	if len(incoming) != 1 {
		t.Fatalf("incoming requests = %d, want 1", len(incoming))
	}

	if err := s.RespondFriend(ctx, b.ID, incoming[0].ID, true); err != nil {
		t.Fatalf("RespondFriend: %v", err)
	}
	friends, _, _ = s.ListFriends(ctx, b.ID)
	if len(friends) != 1 {
		t.Errorf("friends = %d, want 1", len(friends))
	}

	ids, err := s.FriendIDs(ctx, a.ID)
	if err != nil {
		t.Fatalf("FriendIDs: %v", err)
	}
	if len(ids) != 1 || ids[0] != b.ID {
		t.Errorf("friend ids = %v, want [%d]", ids, b.ID)
	}
}

func TestGroupJoinAndMembership(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	owner, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1}, nil)
	member, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 2}, nil)

	group, err := s.CreateGroup(ctx, owner.ID, "Los del Muelle", true)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	if group.InviteCode == "" {
		t.Error("the group should have an invite code")
	}

	if _, err := s.JoinGroup(ctx, member.ID, group.InviteCode); err != nil {
		t.Fatalf("JoinGroup: %v", err)
	}
	role, err := s.Membership(ctx, group.ID, member.ID)
	if err != nil {
		t.Fatalf("Membership: %v", err)
	}
	if role != "member" {
		t.Errorf("role = %q, want member", role)
	}

	// Joining twice must not fail.
	if _, err := s.JoinGroup(ctx, member.ID, group.InviteCode); err != nil {
		t.Fatalf("JoinGroup (twice): %v", err)
	}
	members, _ := s.GroupMemberIDs(ctx, group.ID)
	if len(members) != 2 {
		t.Errorf("member count = %d, want 2", len(members))
	}
}
