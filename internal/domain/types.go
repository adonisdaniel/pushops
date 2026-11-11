package domain

import "time"

// User is a community member. Identity comes from Telegram; nickname is the public handle.
type User struct {
	ID                 int64   `json:"id"`
	TgID               int64   `json:"tgId"`
	Nickname           string  `json:"nickname"`
	NicknameCustom     bool    `json:"nicknameCustom"`
	TgUsername         string  `json:"tgUsername,omitempty"`
	FirstName          string  `json:"firstName,omitempty"`
	PhotoURL           string  `json:"photoUrl,omitempty"`
	WeightKg           float64 `json:"weightKg"`
	WeightSince        int64   `json:"weightSince"`
	WeightsConfirmedAt int64   `json:"weightsConfirmedAt"`
	TrustLevel         int     `json:"trustLevel"`
	CreatedAt          int64   `json:"createdAt"`
}

// WeightStale reports whether the declared body weight is old enough to distrust.
func (u User) WeightStale(now time.Time) bool {
	if u.WeightsConfirmedAt == 0 {
		return true
	}
	return now.Sub(time.UnixMilli(u.WeightsConfirmedAt)) > 30*24*time.Hour
}

// WeightEntry is one historical body-weight record.
type WeightEntry struct {
	WeightKg      float64 `json:"weightKg"`
	EffectiveFrom int64   `json:"effectiveFrom"`
}

// Workout is one recorded set of push-ups.
type Workout struct {
	ID         int64   `json:"id"`
	UserID     int64   `json:"userId"`
	ClientID   string  `json:"clientId,omitempty"`
	Variant    string  `json:"variant"`
	Mode       string  `json:"mode"`
	StartedAt  int64   `json:"startedAt"`
	EndedAt    int64   `json:"endedAt"`
	LocalDate  string  `json:"localDate"`
	DurationMs int64   `json:"durationMs"`
	RepsTotal  int     `json:"repsTotal"`
	RepsValid  int     `json:"repsValid"`
	AvgRepMs   int64   `json:"avgRepMs"`
	BestRepMs  int64   `json:"bestRepMs"`
	Points     float64 `json:"points"`
	Meta       string  `json:"meta,omitempty"`
	CreatedAt  int64   `json:"createdAt"`
}

// Rep is a single attempt inside a workout.
type Rep struct {
	Idx        int     `json:"idx"`
	TMs        int64   `json:"tMs"`
	DurationMs int64   `json:"durationMs"`
	FillMax    float64 `json:"fillMax"`
	ElbowMin   float64 `json:"elbowMin"`
	OK         bool    `json:"ok"`
	Conf       float64 `json:"conf"`
}

// Friendship links two users. Status is one of: pending, accepted, declined, blocked.
type Friendship struct {
	ID          int64  `json:"id"`
	RequesterID int64  `json:"requesterId"`
	AddresseeID int64  `json:"addresseeId"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"createdAt"`
	RespondedAt int64  `json:"respondedAt,omitempty"`
	// UserID is the other participant, from the point of view of the viewer.
	UserID int64 `json:"userId,omitempty"`
	// Denormalised for list rendering.
	Nickname   string `json:"nickname,omitempty"`
	TgUsername string `json:"tgUsername,omitempty"`
	PhotoURL   string `json:"photoUrl,omitempty"`
}

// Group is a community of users with its own leaderboards.
type Group struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	OwnerID    int64  `json:"ownerId"`
	InviteCode string `json:"inviteCode"`
	IsPrivate  bool   `json:"isPrivate"`
	CreatedAt  int64  `json:"createdAt"`
	// Denormalised.
	MemberCount int    `json:"memberCount,omitempty"`
	Role        string `json:"role,omitempty"`
}

// GroupMember associates a user with a group.
type GroupMember struct {
	GroupID  int64  `json:"groupId"`
	UserID   int64  `json:"userId"`
	Role     string `json:"role"`
	JoinedAt int64  `json:"joinedAt"`
}

// Summary aggregates a user's activity over a period.
type Summary struct {
	TotalReps     int     `json:"totalReps"`
	ValidReps     int     `json:"validReps"`
	TotalPoints   float64 `json:"totalPoints"`
	Workouts      int     `json:"workouts"`
	ActiveDays    int     `json:"activeDays"`
	Streak        int     `json:"streak"`
	BestSet       int     `json:"bestSet"`
	BestSetPoints float64 `json:"bestSetPoints"`
	AvgPace       float64 `json:"avgPace"`
	TotalDuration int64   `json:"totalDurationMs"`
}

// Bucket is one point of a time series.
type Bucket struct {
	Date   string  `json:"date"`
	Reps   int     `json:"reps"`
	Points float64 `json:"points"`
	Sets   int     `json:"sets"`
}

// LeaderboardEntry is one row of a ranking.
type LeaderboardEntry struct {
	Rank     int     `json:"rank"`
	UserID   int64   `json:"userId"`
	Nickname string  `json:"nickname"`
	PhotoURL string  `json:"photoUrl,omitempty"`
	Value    float64 `json:"value"`
	Reps     int     `json:"reps"`
	Points   float64 `json:"points"`
	Sets     int     `json:"sets"`
	BestSet  int     `json:"bestSet"`
	Pace     float64 `json:"pace"`
	Streak   int     `json:"streak"`
	IsMe     bool    `json:"isMe"`
}
