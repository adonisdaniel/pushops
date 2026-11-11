package domain

import "math"

// Variant describes a push-up style and how much work each repetition represents.
type Variant struct {
	Key        string  `json:"key"`
	Label      string  `json:"label"`
	Multiplier float64 `json:"multiplier"`
	// ReqMinDepth is the minimum normalised fill the rep must reach for this variant.
	// Heavier variants demand a deeper range of motion.
	ReqMinDepth float64 `json:"reqMinDepth"`
}

// Variants is the catalogue of supported push-up styles.
var Variants = []Variant{
	{Key: "standard", Label: "Estándar", Multiplier: 1.00, ReqMinDepth: 0.72},
	{Key: "wide", Label: "Anchas", Multiplier: 1.05, ReqMinDepth: 0.72},
	{Key: "diamond", Label: "Diamante", Multiplier: 1.15, ReqMinDepth: 0.70},
	{Key: "pike", Label: "Pike", Multiplier: 0.85, ReqMinDepth: 0.78},
	{Key: "knees", Label: "Rodillas", Multiplier: 0.50, ReqMinDepth: 0.62},
	{Key: "decline", Label: "Pies elevados", Multiplier: 1.40, ReqMinDepth: 0.75},
	{Key: "archer", Label: "Archer", Multiplier: 1.60, ReqMinDepth: 0.74},
	{Key: "one_arm", Label: "Una mano", Multiplier: 2.00, ReqMinDepth: 0.78},
	{Key: "hspu", Label: "HSPU (mano elevada)", Multiplier: 2.20, ReqMinDepth: 0.80},
}

// VariantByKey returns the variant definition for key, falling back to standard.
func VariantByKey(key string) Variant {
	for _, v := range Variants {
		if v.Key == key {
			return v
		}
	}
	return Variants[0]
}

// WeightReferenceKg is the body weight that scores 1.0x.
const WeightReferenceKg = 75.0

// WeightFactor normalises body weight into a scoring multiplier, clamped so that
// nobody can farm points by simply declaring a huge weight.
func WeightFactor(weightKg float64) float64 {
	if weightKg <= 0 {
		weightKg = 70
	}
	f := weightKg / WeightReferenceKg
	if f < 0.60 {
		f = 0.60
	}
	if f > 1.80 {
		f = 1.80
	}
	return math.Round(f*1000) / 1000
}

// StreakBonus rewards consistency, capped at 30 days (+30%).
func StreakBonus(streak int) float64 {
	if streak <= 0 {
		return 1.0
	}
	if streak > 30 {
		streak = 30
	}
	return 1 + float64(streak)*0.01
}

// ScorePoints computes the normalised score of a workout. The server always owns this
// calculation; the client only reports raw repetitions.
func ScorePoints(validReps int, variantKey string, weightKg float64, streak int) float64 {
	if validReps <= 0 {
		return 0
	}
	v := VariantByKey(variantKey)
	pts := float64(validReps) * v.Multiplier * WeightFactor(weightKg) * StreakBonus(streak)
	return math.Round(pts*10) / 10
}
