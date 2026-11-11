package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// buildInitData produces a payload signed exactly like Telegram does: the
// fields are joined into a data_check_string and the hash is computed over it.
func buildInitData(t *testing.T, botToken string, fields map[string]string) string {
	t.Helper()
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var dataCheckString strings.Builder
	encoded := make([]string, 0, len(keys))
	for _, k := range keys {
		v := fields[k]
		dataCheckString.WriteString(k + "=" + v)
		if k != keys[len(keys)-1] {
			dataCheckString.WriteString("\n")
		}
		encoded = append(encoded, url.QueryEscape(k)+"="+url.QueryEscape(v))
	}

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(dataCheckString.String()))
	hash := hex.EncodeToString(mac.Sum(nil))

	return strings.Join(encoded, "&") + "&hash=" + hash
}

func TestValidateInitDataAcceptsAValidPayload(t *testing.T) {
	const token = "123456:ABC-DEF"
	fields := map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Unix(), 10),
		"query_id":  "AAH123",
		"user":      `{"id":42,"first_name":"Ada","username":"ada"}`,
	}
	raw := buildInitData(t, token, fields)

	got, err := ValidateInitData(token, raw)
	if err != nil {
		t.Fatalf("ValidateInitData returned %v", err)
	}
	if got.User == nil || got.User.ID != 42 {
		t.Fatalf("unexpected user %+v", got.User)
	}
	if got.User.Username != "ada" {
		t.Errorf("username = %q, want ada", got.User.Username)
	}
	if got.QueryID != "AAH123" {
		t.Errorf("query id = %q", got.QueryID)
	}
}

func TestValidateInitDataRejectsAWrongToken(t *testing.T) {
	const token = "123456:ABC-DEF"
	fields := map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Unix(), 10),
		"user":      `{"id":42,"first_name":"Ada"}`,
	}
	raw := buildInitData(t, token, fields)

	if _, err := ValidateInitData("999999:OTHER", raw); err == nil {
		t.Fatal("expected the signature check to fail with a different bot token")
	}
}

func TestValidateInitDataRejectsATamperedPayload(t *testing.T) {
	const token = "123456:ABC-DEF"
	fields := map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Unix(), 10),
		"user":      `{"id":42,"first_name":"Ada"}`,
	}
	raw := buildInitData(t, token, fields)

	// Swap the user id without touching the hash.
	tampered := strings.Replace(raw, "42", "99", 1)
	if tampered == raw {
		t.Fatal("could not tamper with the payload")
	}
	if _, err := ValidateInitData(token, tampered); err == nil {
		t.Fatal("expected the tampered payload to be rejected")
	}
}

func TestValidateInitDataRejectsExpiredPayloads(t *testing.T) {
	const token = "123456:ABC-DEF"
	fields := map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Add(-48*time.Hour).Unix(), 10),
		"user":      `{"id":42,"first_name":"Ada"}`,
	}
	raw := buildInitData(t, token, fields)

	if _, err := ValidateInitData(token, raw); err == nil {
		t.Fatal("expected an expired payload to be rejected")
	}
}

func TestValidateInitDataRejectsEmptyInput(t *testing.T) {
	if _, err := ValidateInitData("token", ""); err == nil {
		t.Fatal("expected empty initData to be rejected")
	}
	if _, err := ValidateInitData("", "hash=abc"); err == nil {
		t.Fatal("expected a missing bot token to be rejected")
	}
}

func TestTokenRoundTrip(t *testing.T) {
	issuer := NewTokenIssuer("a-secret-value-that-is-long-enough")
	token, expires, err := issuer.Issue(7, 1234)
	if err != nil {
		t.Fatalf("Issue returned %v", err)
	}
	if expires.Before(time.Now()) {
		t.Error("the token should expire in the future")
	}
	claims, err := issuer.Verify(token)
	if err != nil {
		t.Fatalf("Verify returned %v", err)
	}
	if claims.UserID != 7 || claims.TgID != 1234 {
		t.Errorf("unexpected claims %+v", claims)
	}
}

func TestTokenRejectsAForeignSignature(t *testing.T) {
	issuer := NewTokenIssuer("secret-one")
	other := NewTokenIssuer("secret-two")
	token, _, _ := issuer.Issue(7, 1234)

	if _, err := other.Verify(token); err == nil {
		t.Fatal("expected a token signed with another secret to be rejected")
	}
}
