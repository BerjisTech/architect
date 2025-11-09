package db

import (
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"time"
)

func Connect(url string) (*sqlx.DB, error) {
	db, err := sqlx.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return db, nil
}
