package providers

import (
	"context"
	"database/sql"
	"time"

	"github.com/jmoiron/sqlx"
)

func (s *Store) listingsExist(ctx context.Context, listingID string) (bool, error) {
	var exists bool
	if err := s.db.GetContext(ctx, &exists, `
		SELECT EXISTS(SELECT 1 FROM service_listings WHERE id=$1 AND status <> 'archived')
	`, listingID); err != nil {
		return false, err
	}
	return exists, nil
}

// RecordView increments the view counter for the given listing.
func (s *Store) RecordView(ctx context.Context, listingID string) error {
	exists, err := s.listingsExist(ctx, listingID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrListingNotFound
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO service_listing_metrics (listing_id, view_count, last_viewed_at, updated_at)
		VALUES ($1, 1, $2, $2)
		ON CONFLICT (listing_id) DO UPDATE SET
			view_count = service_listing_metrics.view_count + 1,
			last_viewed_at = EXCLUDED.last_viewed_at,
			updated_at = EXCLUDED.updated_at
	`, listingID, now)
	return err
}

// RecordContact increments the contact counter for the given listing.
func (s *Store) RecordContact(ctx context.Context, listingID string) error {
	exists, err := s.listingsExist(ctx, listingID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrListingNotFound
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO service_listing_metrics (listing_id, contact_count, last_contact_at, updated_at)
		VALUES ($1, 1, $2, $2)
		ON CONFLICT (listing_id) DO UPDATE SET
			contact_count = service_listing_metrics.contact_count + 1,
			last_contact_at = EXCLUDED.last_contact_at,
			updated_at = EXCLUDED.updated_at
	`, listingID, now)
	return err
}

func (s *Store) applyMetrics(ctx context.Context, listings []Listing) ([]Listing, error) {
	if len(listings) == 0 {
		return listings, nil
	}
	ids := make([]string, len(listings))
	for i, listing := range listings {
		ids[i] = listing.ID
	}
	query, args, err := sqlx.In(`
		SELECT listing_id, view_count, contact_count, last_viewed_at, last_contact_at
		FROM service_listing_metrics
		WHERE listing_id IN (?)
	`, ids)
	if err != nil {
		return nil, err
	}
	query = s.db.Rebind(query)
	rows, err := s.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type metricRow struct {
		ListingID    string        `db:"listing_id"`
		ViewCount    sql.NullInt64 `db:"view_count"`
		ContactCount sql.NullInt64 `db:"contact_count"`
		LastViewed   sql.NullTime  `db:"last_viewed_at"`
		LastContact  sql.NullTime  `db:"last_contact_at"`
	}

	metrics := make(map[string]ListingMetrics, len(listings))
	for rows.Next() {
		var row metricRow
		if err := rows.StructScan(&row); err != nil {
			return nil, err
		}
		metrics[row.ListingID] = ListingMetrics{
			ViewCount:     row.ViewCount.Int64,
			ContactCount:  row.ContactCount.Int64,
			LastViewedAt:  nullableTimePtr(row.LastViewed),
			LastContactAt: nullableTimePtr(row.LastContact),
		}
	}

	for idx := range listings {
		if metric, ok := metrics[listings[idx].ID]; ok {
			listings[idx].Metrics = metric
		}
	}
	return listings, nil
}
