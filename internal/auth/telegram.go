package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// TelegramUser is the subset of WebAppUser the app relies on.
type TelegramUser struct {
	ID           int64  `json:"id"`
	IsBot        bool   `json:"is_bot"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Username     string `json:"username"`
	LanguageCode string `json:"language_code"`
	PhotoURL     string `json:"photo_url"`
	IsPremium    bool   `json:"is_premium"`
}

// InitData is the validated contents of Telegram.WebApp.initData.
type InitData struct {
	Hash         string        `json:"hash"`
	AuthDate     int64         `json:"auth_date"`
	QueryID      string        `json:"query_id"`
	User         *TelegramUser `json:"user"`
	ChatType     string        `json:"chat_type"`
	ChatInstance string        `json:"chat_instance"`
	StartParam   string        `json:"start_param"`
	Raw          string        `json:"-"`
}

// MaxInitDataAge bounds how old an initData payload may be.
const MaxInitDataAge = 24 * time.Hour

// ValidateInitData verifies the HMAC signature Telegram attaches to initData and
// returns its contents. The bot token never leaves the server.
func ValidateInitData(botToken, raw string) (*InitData, error) {
	if botToken == "" {
		return nil, fmt.Errorf("auth: bot token not configured")
	}
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("auth: empty initData")
	}

	values, err := url.ParseQuery(raw)
	if err != nil {
		return nil, fmt.Errorf("auth: parse initData: %w", err)
	}
	hash := values.Get("hash")
	if hash == "" {
		return nil, fmt.Errorf("auth: initData has no hash")
	}

	// data_check_string: every field except "hash", sorted by key, joined with \n.
	var fields []string
	for k, vs := range values {
		if k == "hash" {
			continue
		}
		// Telegram sends a single value per key.
		v := ""
		if len(vs) > 0 {
			v = vs[0]
		}
		fields = append(fields, k+"="+v)
	}
	sort.Strings(fields)
	dataCheckString := strings.Join(fields, "\n")

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(dataCheckString))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(hash)) {
		return nil, fmt.Errorf("auth: invalid initData signature")
	}

	authDate, err := strconv.ParseInt(firstValue(values, "auth_date"), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("auth: invalid auth_date")
	}
	if time.Since(time.Unix(authDate, 0)) > MaxInitDataAge {
		return nil, fmt.Errorf("auth: initData expired")
	}

	out := &InitData{
		Hash:         hash,
		AuthDate:     authDate,
		QueryID:      firstValue(values, "query_id"),
		ChatType:     firstValue(values, "chat_type"),
		ChatInstance: firstValue(values, "chat_instance"),
		StartParam:   firstValue(values, "start_param"),
		Raw:          raw,
	}

	if u := firstValue(values, "user"); u != "" {
		tu, err := parseTelegramUser(u)
		if err != nil {
			return nil, err
		}
		out.User = tu
	}
	return out, nil
}

func parseTelegramUser(raw string) (*TelegramUser, error) {
	// Telegram sends the user as a percent-encoded JSON object, which
	// url.ParseQuery has already decoded into raw JSON by the time we get here.
	var u TelegramUser
	if err := json.Unmarshal([]byte(raw), &u); err != nil {
		return nil, fmt.Errorf("auth: parse user: %w", err)
	}
	if u.ID == 0 {
		return nil, fmt.Errorf("auth: invalid user id")
	}
	return &u, nil
}

// firstValue returns the first value of a key, or "" when absent.
func firstValue(values url.Values, key string) string {
	if vs := values[key]; len(vs) > 0 {
		return vs[0]
	}
	return ""
}

// DisplayName returns a friendly name for the Telegram user.
func (u *TelegramUser) DisplayName() string {
	if u == nil {
		return ""
	}
	name := strings.TrimSpace(u.FirstName + " " + u.LastName)
	if name == "" {
		return u.Username
	}
	return name
}
