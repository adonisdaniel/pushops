package domain

import "testing"

func TestWeightFactorIsClamped(t *testing.T) {
	cases := []struct {
		weight float64
		want   float64
	}{
		{50, 0.667},
		{45, 0.6},
		{75, 1},
		{100, 1.333},
		{135, 1.8},
		{200, 1.8},
		{0, 0.933},
	}
	for _, c := range cases {
		got := WeightFactor(c.weight)
		if diff := got - c.want; diff > 0.002 || diff < -0.002 {
			t.Errorf("WeightFactor(%v) = %v, want %v", c.weight, got, c.want)
		}
	}
}

func TestScorePoints(t *testing.T) {
	// 10 standard reps at 75 kg, no streak: 10 * 1.0 * 1.0 * 1.0
	if got := ScorePoints(10, "standard", 75, 0); got != 10 {
		t.Errorf("ScorePoints standard = %v, want 10", got)
	}
	// The same 10 reps in a harder variant must score more.
	if oneArm := ScorePoints(10, "one_arm", 75, 0); oneArm != 20 {
		t.Errorf("ScorePoints one_arm = %v, want 20", oneArm)
	}
	// A heavier athlete scores more for the same work.
	if light := ScorePoints(10, "standard", 60, 0); light >= 10 {
		t.Errorf("ScorePoints at 60kg = %v, want less than 10", light)
	}
	// The streak bonus never exceeds 30%.
	noStreak := ScorePoints(10, "standard", 75, 0)
	longStreak := ScorePoints(10, "standard", 75, 999)
	if ratio := longStreak / noStreak; ratio > 1.301 {
		t.Errorf("streak bonus ratio = %v, want at most 1.30", ratio)
	}
	// No repetitions means no points.
	if got := ScorePoints(0, "standard", 75, 10); got != 0 {
		t.Errorf("ScorePoints(0) = %v, want 0", got)
	}
}

func TestVariantByKeyFallsBackToStandard(t *testing.T) {
	if got := VariantByKey("no-existe").Key; got != "standard" {
		t.Errorf("VariantByKey fallback = %v, want standard", got)
	}
}

func TestValidateNickname(t *testing.T) {
	valid := []string{"Tigre Veloz", "abc", "Puma-de-Hierro", "Atleta 99", "Ñandú_7"}
	for _, v := range valid {
		if err := ValidateNickname(v); err != nil {
			t.Errorf("ValidateNickname(%q) = %v, want nil", v, err)
		}
	}
	invalid := []string{"", "ab", "   ", "user!", "user@host", "-leading", "trailing-", "12345"}
	for _, v := range invalid {
		if err := ValidateNickname(v); err == nil {
			t.Errorf("ValidateNickname(%q) = nil, want an error", v)
		}
	}
	long := ""
	for i := 0; i < 30; i++ {
		long += "a"
	}
	if err := ValidateNickname(long); err == nil {
		t.Error("ValidateNickname should reject a nickname longer than 24 characters")
	}
}

func TestRandomNicknameShape(t *testing.T) {
	n := RandomNickname(nil)
	if len(n) < 3 {
		t.Errorf("RandomNickname produced %q", n)
	}
	if err := ValidateNickname(n); err != nil {
		t.Errorf("RandomNickname produced an invalid nickname %q: %v", n, err)
	}
}
