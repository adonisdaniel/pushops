package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// SessionTTL is how long an issued session token stays valid.
const SessionTTL = 30 * 24 * time.Hour

// Claims is the JWT payload for an authenticated session.
type Claims struct {
	UserID int64 `json:"uid"`
	TgID   int64 `json:"tg"`
	jwt.RegisteredClaims
}

// TokenIssuer signs and verifies session tokens.
type TokenIssuer struct {
	secret []byte
}

// NewTokenIssuer builds an issuer backed by the server secret.
func NewTokenIssuer(secret string) *TokenIssuer {
	return &TokenIssuer{secret: []byte(secret)}
}

// Issue returns a signed token for a user.
func (t *TokenIssuer) Issue(userID, tgID int64) (string, time.Time, error) {
	expires := time.Now().Add(SessionTTL)
	claims := Claims{
		UserID: userID,
		TgID:   tgID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expires),
			Issuer:    "pushops",
			Subject:   fmt.Sprintf("%d", userID),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expires, nil
}

// ErrInvalidToken is returned when a token cannot be trusted.
var ErrInvalidToken = errors.New("auth: invalid token")

// Verify parses and validates a token, returning its claims.
func (t *TokenIssuer) Verify(token string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(tok *jwt.Token) (any, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", tok.Header["alg"])
		}
		return t.secret, nil
	})
	if err != nil {
		return nil, ErrInvalidToken
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid || claims.UserID <= 0 {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
