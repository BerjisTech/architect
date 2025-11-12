package db

import (
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

type Pool struct {
	Primary  *sqlx.DB
	Replicas []*sqlx.DB

	next uint32
}

func Connect(url string) (*sqlx.DB, error) {
	return open(url)
}

func ConnectPool(primaryURL string, replicaURLs []string) (*Pool, error) {
	if strings.TrimSpace(primaryURL) == "" {
		return nil, errors.New("primary database url is required")
	}

	primary, err := open(primaryURL)
	if err != nil {
		return nil, err
	}
	pool := &Pool{Primary: primary}

	var errs []error
	for idx, replicaURL := range replicaURLs {
		trimmed := strings.TrimSpace(replicaURL)
		if trimmed == "" {
			continue
		}
		replica, err := open(trimmed)
		if err != nil {
			errs = append(errs, fmt.Errorf("replica[%d]: %w", idx, err))
			continue
		}
		pool.Replicas = append(pool.Replicas, replica)
	}

	if len(errs) > 0 {
		return pool, errors.Join(errs...)
	}
	return pool, nil
}

func (p *Pool) Reader() *sqlx.DB {
	if p == nil {
		return nil
	}
	if len(p.Replicas) == 0 {
		return p.Primary
	}
	idx := atomic.AddUint32(&p.next, 1)
	return p.Replicas[int(idx)%len(p.Replicas)]
}

func (p *Pool) Close() error {
	if p == nil {
		return nil
	}
	var errs []error
	if p.Primary != nil {
		if err := p.Primary.Close(); err != nil {
			errs = append(errs, fmt.Errorf("primary: %w", err))
		}
	}
	for i, replica := range p.Replicas {
		if replica == nil {
			continue
		}
		if err := replica.Close(); err != nil {
			errs = append(errs, fmt.Errorf("replica[%d]: %w", i, err))
		}
	}
	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}

func open(url string) (*sqlx.DB, error) {
	db, err := sqlx.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}
