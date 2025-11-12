package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/joho/godotenv"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/config"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/coreapi"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/db"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/migrate"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/secrets"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/server"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	migrationsDir := resolveMigrationsDir(cfg.MigrationsDir)
	pool, err := db.ConnectPool(cfg.DatabaseURL, cfg.DatabaseReadURLs)
	if err != nil {
		logger.Error("database connection failed", "error", err)
	}

	var conn *sqlx.DB
	if pool != nil {
		conn = pool.Primary
	}

	if conn != nil {
		runner := migrate.Runner{Dir: migrationsDir}
		if err := runner.Up(conn); err != nil {
			logger.Error("database migrations failed", "dir", migrationsDir, "error", err)
		} else {
			logger.Info("database migrations applied", "dir", migrationsDir)
		}
	}

	coreAPIToken, tokenErr := secrets.ServiceToken(cfg.CoreAPIServiceToken, cfg.CoreAPIServiceTokenFile)
	if tokenErr != nil {
		logger.Warn("core api service token unavailable", "error", tokenErr)
	}
	var coreAPIClient *coreapi.Client
	if token := strings.TrimSpace(coreAPIToken); token != "" {
		client, clientErr := coreapi.New(cfg.CoreAPIBase, coreapi.WithAuthProvider(coreapi.StaticBearerToken(token)))
		if clientErr != nil {
			logger.Error("core api client init failed", "error", clientErr)
		} else {
			coreAPIClient = client
		}
	} else {
		logger.Warn("core api service token not provided; outbound service calls disabled")
	}

	app := server.New(server.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		DB:             conn,
		ReadDB: func() *sqlx.DB {
			if pool == nil {
				return conn
			}
			return pool.Reader()
		},
		Env:           cfg.Env,
		CoreAPIBase:   cfg.CoreAPIBase,
		CoreAPIClient: coreAPIClient,
		Logger:        logger,
	})
	addr := ":" + cfg.Port
	logger.Info("starting service", "app", cfg.AppName, "addr", addr, "env", cfg.Env)

	errCh := make(chan error, 1)
	go func() {
		if listenErr := app.Listen(addr); listenErr != nil {
			errCh <- listenErr
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	case listenErr, ok := <-errCh:
		if ok && listenErr != nil {
			logger.Error("server listener error", "error", listenErr)
		}
	}
	stop()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
	if pool != nil {
		if err := pool.Close(); err != nil {
			logger.Warn("failed to close database connections", "error", err)
		}
	} else if conn != nil {
		if err := conn.Close(); err != nil {
			logger.Warn("failed to close database connection", "error", err)
		}
	}
	logger.Info("service stopped")
}

func resolveMigrationsDir(dir string) string {
	candidates := []string{dir}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, dir))
		candidates = append(candidates, filepath.Join(wd, "architect", "service", dir))
	}
	if exe, err := os.Executable(); err == nil {
		base := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(base, dir))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return dir
}
