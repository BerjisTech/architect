package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/config"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/db"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/migrate"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/server"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	migrationsDir := resolveMigrationsDir(cfg.MigrationsDir)
	conn, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err)
	} else if conn != nil {
		runner := migrate.Runner{Dir: migrationsDir}
		if err := runner.Up(conn); err != nil {
			logger.Error("database migrations failed", "dir", migrationsDir, "error", err)
		} else {
			logger.Info("database migrations applied", "dir", migrationsDir)
		}
	}

	app := server.New(server.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		DB:             conn,
		Env:            cfg.Env,
		CoreAPIBase:    cfg.CoreAPIBase,
		Logger:         logger,
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
	if conn != nil {
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
