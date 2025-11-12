package config

import (
	"os"
	"strings"
)

type Config struct {
	AppName                 string
	Env                     string
	Port                    string
	DatabaseURL             string
	DatabaseReadURLs        []string
	CoreAPIBase             string
	CoreAPIServiceToken     string
	CoreAPIServiceTokenFile string
	AllowedOrigins          string
	MigrationsDir           string
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvSlice(k string) []string {
	raw := strings.TrimSpace(os.Getenv(k))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func Load() Config {
	return Config{
		AppName:                 getenv("APP_NAME", "berjis-architect"),
		Env:                     getenv("APP_ENV", "development"),
		Port:                    getenv("PORT", "8091"),
		DatabaseURL:             getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5444/berjis_architect?sslmode=disable"),
		DatabaseReadURLs:        getenvSlice("DATABASE_READ_URLS"),
		CoreAPIBase:             getenv("CORE_API_BASE", "http://localhost:8080"),
		CoreAPIServiceToken:     getenv("CORE_API_SERVICE_TOKEN", ""),
		CoreAPIServiceTokenFile: getenv("CORE_API_SERVICE_TOKEN_FILE", ""),
		AllowedOrigins:          getenv("ALLOWED_ORIGINS", "*"),
		MigrationsDir:           getenv("MIGRATIONS_DIR", "migrations"),
	}
}
