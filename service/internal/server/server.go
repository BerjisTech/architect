package server

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/jmoiron/sqlx"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/auth"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/coreapi"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/profile"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/providers"
	coreauth "github.com/berjistech/berjis-ecosystem/shared/coreauth"
)

type Options struct {
	AllowedOrigins string
	DB             *sqlx.DB
	ReadDB         func() *sqlx.DB
	Env            string
	CoreAPIBase    string
	CoreAPIClient  *coreapi.Client
	Logger         *slog.Logger
	MediaUploadDir string
}

func New(opts Options) *fiber.App {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	app := fiber.New()
	app.Use(cors.New(cors.Config{
		AllowOrigins:     opts.AllowedOrigins,
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Authorization,Content-Type,Accept,X-User-UUID,X-User-Roles",
		AllowCredentials: true,
	}))

	if dir := strings.TrimSpace(opts.MediaUploadDir); dir != "" {
		app.Static("/svc/media", dir)
	}

	app.Get("/v1/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"success": true, "message": "ok"})
	})

	httpClient := &http.Client{Timeout: 8 * time.Second}
	var authVerifier *coreauth.Verifier
	if base := strings.TrimSpace(opts.CoreAPIBase); base != "" {
		if v, err := coreauth.NewVerifier(coreauth.Config{
			CoreAPIBase: base,
			HTTPClient:  httpClient,
		}); err != nil {
			logger.Warn("coreauth verifier init failed", "error", err)
		} else {
			authVerifier = v
		}
	}

	requireAuth := auth.Middleware(auth.Options{
		CoreAPIBase: opts.CoreAPIBase,
		Env:         opts.Env,
		HTTPClient:  httpClient,
		Verifier:    authVerifier,
	})

	public := app.Group("/v1")
	protected := app.Group("/v1", requireAuth)
	db := opts.DB
	readDBFn := opts.ReadDB
	if readDBFn == nil {
		readDBFn = func() *sqlx.DB { return db }
	}
	if db == nil {
		logger.Warn("database connection not provided; floorplan routes will return 503")
	}

	if db != nil {
		profileStore := profile.NewStore(db)
		registerProfileRoutes(public, protected, profileStore, db)

		providerStore := providers.NewStore(db)
		registerProviderRoutes(public, protected, providerStore, db, opts.CoreAPIClient, logger, opts.MediaUploadDir)
	}

	// Floorplans CRUD
	type floorplan struct {
		ID          string          `db:"id" json:"id"`
		Name        string          `db:"name" json:"name"`
		OwnerUserID *string         `db:"owner_user_id" json:"ownerUserId,omitempty"`
		Data        json.RawMessage `db:"data" json:"data"`
		UpdatedAt   time.Time       `db:"updated_at" json:"updatedAt"`
	}

	protected.Post("/floorplans", func(c *fiber.Ctx) error {
		if db == nil {
			logger.Error("floorplan create attempted while database unavailable")
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "message": "storage unavailable"})
		}
		var in struct {
			Name        string          `json:"name"`
			Data        json.RawMessage `json:"data"`
			OwnerUserID *string         `json:"ownerUserId"`
		}
		if err := c.BodyParser(&in); err != nil || strings.TrimSpace(in.Name) == "" || len(in.Data) == 0 {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "invalid body"})
		}
		id := strings.ReplaceAll(time.Now().Format("20060102T150405.000Z07:00"), ":", "") + RandomSuffix(4)
		_, err := db.Exec(`INSERT INTO floorplans(id,name,owner_user_id,data) VALUES($1,$2,$3,$4)`, id, in.Name, in.OwnerUserID, in.Data)
		if err != nil {
			logger.Error("failed to insert floorplan", "error", err)
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"id": id}})
	})

	protected.Put("/floorplans/:id", func(c *fiber.Ctx) error {
		if db == nil {
			logger.Error("floorplan update attempted while database unavailable", "id", c.Params("id"))
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "message": "storage unavailable"})
		}
		id := c.Params("id")
		var in struct {
			Name *string          `json:"name"`
			Data *json.RawMessage `json:"data"`
		}
		if err := c.BodyParser(&in); err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false})
		}
		// Update name and/or data
		if in.Name != nil {
			if _, err := db.Exec(`UPDATE floorplans SET name=$1, updated_at=now() WHERE id=$2`, *in.Name, id); err != nil {
				logger.Error("failed to update floorplan name", "id", id, "error", err)
				return c.Status(500).JSON(fiber.Map{"success": false})
			}
		}
		if in.Data != nil {
			if _, err := db.Exec(`UPDATE floorplans SET data=$1, updated_at=now() WHERE id=$2`, *in.Data, id); err != nil {
				logger.Error("failed to update floorplan data", "id", id, "error", err)
				return c.Status(500).JSON(fiber.Map{"success": false})
			}
		}
		return c.JSON(fiber.Map{"success": true})
	})

	protected.Get("/floorplans/:id", func(c *fiber.Ctx) error {
		reader := readDBFn()
		if reader == nil {
			logger.Error("floorplan fetch attempted while database unavailable", "id", c.Params("id"))
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "message": "storage unavailable"})
		}
		id := c.Params("id")
		var row floorplan
		err := reader.Get(&row, `SELECT id,name,owner_user_id,data,updated_at FROM floorplans WHERE id=$1`, id)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).JSON(fiber.Map{"success": false})
			}
			logger.Error("failed to load floorplan", "id", id, "error", err)
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		return c.JSON(fiber.Map{"success": true, "data": row})
	})

	protected.Get("/floorplans", func(c *fiber.Ctx) error {
		reader := readDBFn()
		if reader == nil {
			logger.Error("floorplan list attempted while database unavailable")
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "message": "storage unavailable"})
		}
		owner := strings.TrimSpace(c.Query("ownerUserId"))
		const limit = 100
		var rows []floorplan
		var err error
		if owner != "" {
			err = reader.Select(&rows, `SELECT id,name,owner_user_id,data,updated_at FROM floorplans WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT $2`, owner, limit)
		} else {
			err = reader.Select(&rows, `SELECT id,name,owner_user_id,data,updated_at FROM floorplans ORDER BY updated_at DESC LIMIT $1`, limit)
		}
		if err != nil {
			logger.Error("failed to list floorplans", "error", err)
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		return c.JSON(fiber.Map{"success": true, "data": rows})
	})

	return app
}

// RandomSuffix returns an uppercase alpha suffix of length n.
func RandomSuffix(n int) string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, n)
	ts := time.Now().UnixNano()
	for i := 0; i < n; i++ {
		ts = (ts*1664525 + 1013904223) % 4294967296
		b[i] = alphabet[int(ts)%len(alphabet)]
	}
	return string(b)
}
