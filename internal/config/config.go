package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds every runtime setting for the pushops server.
type Config struct {
	Port             string
	PublicURL        string
	TelegramBotToken string
	DatabaseURL      string
	AuthToken        string
	JWTSecret        string
	AllowOrigins     []string
	DevMode          bool
}

func Load() (*Config, error) {
	c := &Config{
		Port:             env("PORT", "8080"),
		PublicURL:        strings.TrimRight(env("PUBLIC_URL", "http://localhost:8080"), "/"),
		TelegramBotToken: env("TELEGRAM_BOT_TOKEN", ""),
		DatabaseURL:      env("TURSO_DATABASE_URL", ""),
		AuthToken:        env("TURSO_AUTH_TOKEN", ""),
		JWTSecret:        env("JWT_SECRET", ""),
		AllowOrigins:     splitCSV(env("ALLOW_ORIGINS", "*")),
		DevMode:          envBool("DEV_MODE", false),
	}

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("config: TURSO_DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return nil, fmt.Errorf("config: JWT_SECRET is required")
	}
	if len(c.JWTSecret) < 16 {
		return nil, fmt.Errorf("config: JWT_SECRET must be at least 16 characters")
	}
	if c.TelegramBotToken == "" && !c.DevMode {
		return nil, fmt.Errorf("config: TELEGRAM_BOT_TOKEN is required (set DEV_MODE=true to skip)")
	}
	return c, nil
}

// HasTelegram reports whether real Telegram initData can be validated.
func (c *Config) HasTelegram() bool { return c.TelegramBotToken != "" }

func env(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

func envBool(k string, def bool) bool {
	v, ok := os.LookupEnv(k)
	if !ok || v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
