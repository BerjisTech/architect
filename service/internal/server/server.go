package server

import (
    "database/sql"
    "encoding/json"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/cors"
    "github.com/jmoiron/sqlx"
)

type Options struct {
    AllowedOrigins string
    DB             *sqlx.DB
    Env            string
    CoreAPIBase    string
}

func New(opts Options) *fiber.App {
    app := fiber.New()
    app.Use(cors.New(cors.Config{
        AllowOrigins:     opts.AllowedOrigins,
        AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        AllowHeaders:     "Authorization,Content-Type,Accept",
        AllowCredentials: true,
    }))

    app.Get("/v1/health", func(c *fiber.Ctx) error {
        return c.JSON(fiber.Map{"success": true, "message": "ok"})
    })

    // Floorplans CRUD (minimal authless draft endpoints)
    type floorplan struct {
        ID          string          `db:"id" json:"id"`
        Name        string          `db:"name" json:"name"`
        OwnerUserID *string         `db:"owner_user_id" json:"ownerUserId,omitempty"`
        Data        json.RawMessage `db:"data" json:"data"`
        UpdatedAt   time.Time       `db:"updated_at" json:"updatedAt"`
    }

    app.Post("/v1/floorplans", func(c *fiber.Ctx) error {
        var in struct{ Name string `json:"name"`; Data json.RawMessage `json:"data"`; OwnerUserID *string `json:"ownerUserId"` }
        if err := c.BodyParser(&in); err != nil || strings.TrimSpace(in.Name) == "" || len(in.Data) == 0 {
            return c.Status(400).JSON(fiber.Map{"success": false, "message": "invalid body"})
        }
        id := strings.ReplaceAll(time.Now().Format("20060102T150405.000Z07:00"), ":", "") + RandomSuffix(4)
        _, err := opts.DB.Exec(`INSERT INTO floorplans(id,name,owner_user_id,data) VALUES($1,$2,$3,$4)`, id, in.Name, in.OwnerUserID, in.Data)
        if err != nil { return c.Status(500).JSON(fiber.Map{"success": false}) }
        return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"id": id}})
    })

    app.Put("/v1/floorplans/:id", func(c *fiber.Ctx) error {
        id := c.Params("id")
        var in struct{ Name *string `json:"name"`; Data *json.RawMessage `json:"data"` }
        if err := c.BodyParser(&in); err != nil { return c.Status(400).JSON(fiber.Map{"success": false}) }
        // Update name and/or data
        if in.Name != nil { _, _ = opts.DB.Exec(`UPDATE floorplans SET name=$1, updated_at=now() WHERE id=$2`, *in.Name, id) }
        if in.Data != nil { _, _ = opts.DB.Exec(`UPDATE floorplans SET data=$1, updated_at=now() WHERE id=$2`, *in.Data, id) }
        return c.JSON(fiber.Map{"success": true})
    })

    app.Get("/v1/floorplans/:id", func(c *fiber.Ctx) error {
        id := c.Params("id")
        var row floorplan
        err := opts.DB.Get(&row, `SELECT id,name,owner_user_id,data,updated_at FROM floorplans WHERE id=$1`, id)
        if err != nil {
            if err == sql.ErrNoRows { return c.Status(404).JSON(fiber.Map{"success": false}) }
            return c.Status(500).JSON(fiber.Map{"success": false})
        }
        return c.JSON(fiber.Map{"success": true, "data": row})
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
