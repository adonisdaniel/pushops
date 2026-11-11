package httpx

import (
	"net/http"
	"strings"
)

// TokenVerifier turns a bearer token into a user id.
type TokenVerifier func(token string) (int64, error)

// Authenticate rejects requests without a valid bearer token.
func Authenticate(verify TokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("Authorization")
			if raw == "" {
				// Allow the token as a query parameter for download links.
				raw = "Bearer " + r.URL.Query().Get("token")
			}
			parts := strings.SplitN(raw, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
				Error(w, http.StatusUnauthorized, "autenticación requerida")
				return
			}
			userID, err := verify(strings.TrimSpace(parts[1]))
			if err != nil || userID <= 0 {
				Error(w, http.StatusUnauthorized, "sesión inválida o expirada")
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), userID)))
		})
	}
}
