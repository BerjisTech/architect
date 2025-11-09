package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	coreauth "github.com/berjistech/berjis-ecosystem/shared/coreauth"
)

// Options controls how the auth middleware verifies incoming requests.
type Options struct {
	CoreAPIBase string
	Env         string
	HTTPClient  *http.Client
	Verifier    *coreauth.Verifier
}

const userKey = "architect.user"

// Middleware enforces that a valid Core API session exists before allowing requests through.
func Middleware(opts Options) fiber.Handler {
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return func(c *fiber.Ctx) error {
		token := bearerFromAuthz(c.Get("Authorization"))
		if token == "" {
			token = strings.TrimSpace(c.Cookies("access", ""))
		}

		if opts.Verifier != nil && token != "" {
			if claims, err := opts.Verifier.Verify(token); err == nil {
				c.Locals(userKey, claims.UUID)
				return c.Next()
			} else if errors.Is(err, coreauth.ErrTokenInvalid) || errors.Is(err, coreauth.ErrTokenExpired) || errors.Is(err, coreauth.ErrTokenMissing) {
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "message": "unauthorized"})
			}
		}

		if strings.EqualFold(opts.Env, "development") {
			if devID := strings.TrimSpace(c.Get("X-User-UUID")); devID != "" {
				c.Locals(userKey, devID)
				return c.Next()
			}
		}

		base := strings.TrimSpace(opts.CoreAPIBase)
		if base != "" {
			req, _ := http.NewRequest(http.MethodGet, strings.TrimRight(base, "/")+"/v1/auth/verify", nil)
			if v := c.Get("Authorization"); v != "" {
				req.Header.Set("Authorization", v)
			}
			if v := c.Get("Cookie"); v != "" {
				req.Header.Set("Cookie", v)
			}
			req.Header.Set("Accept", "application/json")
			resp, err := client.Do(req)
			if err == nil && resp != nil {
				defer resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					var body map[string]any
					if err := json.NewDecoder(resp.Body).Decode(&body); err == nil {
						if id := extractUUID(body); id != "" {
							c.Locals(userKey, id)
							return c.Next()
						}
					}
				}
			}
		}

		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "message": "login required"})
	}
}

// UserID returns the verified UUID from the current context.
func UserID(c *fiber.Ctx) string {
	if v := c.Locals(userKey); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func bearerFromAuthz(authz string) string {
	if strings.HasPrefix(strings.ToLower(authz), "bearer ") {
		return strings.TrimSpace(authz[7:])
	}
	return strings.TrimSpace(authz)
}

func extractUUID(body map[string]any) string {
	data, _ := body["data"].(map[string]any)
	if data == nil {
		return ""
	}
	valid, _ := data["valid"].(bool)
	if !valid {
		return ""
	}
	if uuid, ok := data["uuid"].(string); ok && strings.TrimSpace(uuid) != "" {
		return strings.TrimSpace(uuid)
	}
	if uuid, ok := data["uid"].(string); ok && strings.TrimSpace(uuid) != "" {
		return strings.TrimSpace(uuid)
	}
	if uuid, ok := data["userId"].(string); ok && strings.TrimSpace(uuid) != "" {
		return strings.TrimSpace(uuid)
	}
	return ""
}
