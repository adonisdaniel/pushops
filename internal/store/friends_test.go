package store

import (
	"context"
	"testing"

	"github.com/adonis/pushops/internal/auth"
	"github.com/adonis/pushops/internal/domain"
)

// The API must answer an empty list and never null, otherwise the frontend
// breaks when it calls .map() on the result.
func TestListFriendsReturnsEmptySlices(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, _, err := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1}, nil)
	if err != nil {
		t.Fatalf("EnsureUser: %v", err)
	}

	friends, incoming, err := s.ListFriends(ctx, u.ID)
	if err != nil {
		t.Fatalf("ListFriends: %v", err)
	}
	if friends == nil {
		t.Error("friends must be an empty slice, not nil")
	}
	if incoming == nil {
		t.Error("incoming must be an empty slice, not nil")
	}
	if len(friends) != 0 || len(incoming) != 0 {
		t.Errorf("unexpected lists: %d friends, %d incoming", len(friends), len(incoming))
	}
}

// The denormalised user id must be the other participant.
func TestListFriendsExposesTheOtherUser(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	a, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 1}, nil)
	b, _, _ := s.EnsureUser(ctx, &auth.TelegramUser{ID: 2}, nil)

	if _, err := s.RequestFriend(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("RequestFriend: %v", err)
	}
	if err := s.RespondFriend(ctx, b.ID, mustFriendship(t, s, a.ID, b.ID).ID, true); err != nil {
		t.Fatalf("RespondFriend: %v", err)
	}

	friends, _, err := s.ListFriends(ctx, a.ID)
	if err != nil {
		t.Fatalf("ListFriends: %v", err)
	}
	if len(friends) != 1 {
		t.Fatalf("friends = %d, want 1", len(friends))
	}
	if friends[0].UserID != b.ID {
		t.Errorf("user id = %d, want %d", friends[0].UserID, b.ID)
	}
	if friends[0].Nickname == "" {
		t.Error("the nickname should be denormalised")
	}
}

func mustFriendship(t *testing.T, s *Store, a, b int64) *domain.Friendship {
	t.Helper()
	f, err := s.findFriendship(context.Background(), a, b)
	if err != nil {
		t.Fatalf("findFriendship: %v", err)
	}
	return f
}
