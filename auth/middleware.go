package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const UserContextKey contextKey = "user"

func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var token string
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		} else {
			token = r.URL.Query().Get("token")
		}
		if token == "" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		claims, err := ValidateToken(token)
		if err != nil {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), UserContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func AdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(UserContextKey).(*Claims)
		if !ok || claims.Role != "admin" {
			http.Error(w, `{"error":"admin only"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func GetUser(r *http.Request) *Claims {
	claims, _ := r.Context().Value(UserContextKey).(*Claims)
	return claims
}

// WithUser carries already-authenticated claims into handlers that use a
// short-lived credential rather than parsing the long-lived JWT again.
func WithUser(r *http.Request, claims *Claims) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), UserContextKey, claims))
}

// GetUserWS extracts JWT from Authorization header or "token" query param (for WebSocket).
func GetUserWS(r *http.Request) *Claims {
	// Try context first (set by Middleware)
	if claims, ok := r.Context().Value(UserContextKey).(*Claims); ok {
		return claims
	}
	// Try Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := ValidateToken(token)
		if err == nil {
			return claims
		}
	}
	// Try query parameter (for WebSocket connections)
	token := r.URL.Query().Get("token")
	if token != "" {
		claims, err := ValidateToken(token)
		if err == nil {
			return claims
		}
	}
	return nil
}
