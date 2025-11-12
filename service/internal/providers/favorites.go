package providers

import (
	"context"
	"time"
)

// AddFavorite adds a listing to the user's favorites.
func (s *Store) AddFavorite(ctx context.Context, userUUID, listingID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO provider_favorites (user_uuid, listing_id, created_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_uuid, listing_id) DO NOTHING
	`, userUUID, listingID, time.Now().UTC())
	return err
}

// RemoveFavorite removes a listing from the user's favorites.
func (s *Store) RemoveFavorite(ctx context.Context, userUUID, listingID string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM provider_favorites WHERE user_uuid=$1 AND listing_id=$2
	`, userUUID, listingID)
	return err
}

// ListFavorites returns the user's favorite listings.
func (s *Store) ListFavorites(ctx context.Context, userUUID string, limit int) ([]Listing, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryxContext(ctx, `
		SELECT l.id, l.user_uuid, l.title, l.summary, l.description, l.category, l.subcategory,
		       l.pricing_model, l.base_price_cents, l.currency, l.status, l.attributes,
		       l.created_at, l.updated_at
		FROM provider_favorites f
		INNER JOIN service_listings l ON l.id = f.listing_id
		WHERE f.user_uuid=$1
		ORDER BY f.created_at DESC
		LIMIT $2
	`, userUUID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var listings []Listing
	for rows.Next() {
		lst, err := scanListing(rows)
		if err != nil {
			return nil, err
		}
		listings = append(listings, lst)
	}
	return listings, rows.Err()
}

// IsFavorite reports whether the listing is favorited by the user.
func (s *Store) IsFavorite(ctx context.Context, userUUID, listingID string) (bool, error) {
	var exists bool
	if err := s.db.GetContext(ctx, &exists, `
		SELECT EXISTS(
			SELECT 1 FROM provider_favorites WHERE user_uuid=$1 AND listing_id=$2
		)
	`, userUUID, listingID); err != nil {
		return false, err
	}
	return exists, nil
}

// FavoriteIDs returns a set of listing IDs favorited by the user.
func (s *Store) FavoriteIDs(ctx context.Context, userUUID string) (map[string]struct{}, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT listing_id FROM provider_favorites WHERE user_uuid=$1
	`, userUUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]struct{})
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result[id] = struct{}{}
	}
	return result, rows.Err()
}
