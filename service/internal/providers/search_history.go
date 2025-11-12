package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// SearchHistoryItem represents a recent search entry.
type SearchHistoryItem struct {
	Query      string         `json:"query"`
	Filters    map[string]any `json:"filters"`
	SearchedAt time.Time      `json:"searchedAt"`
}

// RecordSearch persists a user's search filters for future suggestions.
func (s *Store) RecordSearch(ctx context.Context, userUUID string, filters SearchFilters) error {
	if userUUID == "" {
		return nil
	}
	record := map[string]any{}
	if len(filters.Categories) > 0 {
		record["categories"] = filters.Categories
	}
	if len(filters.Subcategories) > 0 {
		record["subcategories"] = filters.Subcategories
	}
	if len(filters.CountryCodes) > 0 {
		record["countries"] = filters.CountryCodes
	}
	if filters.Region != "" {
		record["region"] = filters.Region
	}
	if filters.MinPriceCents > 0 {
		record["minPriceCents"] = filters.MinPriceCents
	}
	if filters.MaxPriceCents > 0 {
		record["maxPriceCents"] = filters.MaxPriceCents
	}
	if filters.MinRating > 0 {
		record["minRating"] = filters.MinRating
	}
	if filters.Latitude != nil && filters.Longitude != nil {
		record["latitude"] = *filters.Latitude
		record["longitude"] = *filters.Longitude
		if filters.RadiusKm != nil {
			record["radiusKm"] = *filters.RadiusKm
		}
	}
	if filters.DayOfWeek != nil {
		record["dayOfWeek"] = *filters.DayOfWeek
	}
	if filters.StartMinute != nil {
		record["startMinute"] = *filters.StartMinute
	}
	if filters.EndMinute != nil {
		record["endMinute"] = *filters.EndMinute
	}

	filtersJSON, err := json.Marshal(record)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO provider_search_history (user_uuid, query, filters, searched_at)
		VALUES ($1, $2, $3, $4)
	`, userUUID, filters.Query, filtersJSON, time.Now().UTC())
	return err
}

// RecentSearches returns recent search entries for a user.
func (s *Store) RecentSearches(ctx context.Context, userUUID string, limit int) ([]SearchHistoryItem, error) {
	if userUUID == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	rows, err := s.db.QueryxContext(ctx, `
		SELECT query, filters, searched_at
		FROM provider_search_history
		WHERE user_uuid=$1
		ORDER BY searched_at DESC
		LIMIT $2
	`, userUUID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []SearchHistoryItem
	for rows.Next() {
		var (
			query      sql.NullString
			filtersRaw []byte
			searchedAt time.Time
		)
		if err := rows.Scan(&query, &filtersRaw, &searchedAt); err != nil {
			return nil, err
		}
		item := SearchHistoryItem{
			Query:      strings.TrimSpace(query.String),
			Filters:    map[string]any{},
			SearchedAt: searchedAt,
		}
		if len(filtersRaw) > 0 {
			if err := json.Unmarshal(filtersRaw, &item.Filters); err != nil {
				item.Filters = map[string]any{}
			}
		}
		history = append(history, item)
	}
	return history, rows.Err()
}

// RecommendationsForUser returns listings recommended based on favorites and recent searches.
func (s *Store) RecommendationsForUser(ctx context.Context, userUUID string, limit int) ([]SearchResult, error) {
	if userUUID == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 30 {
		limit = 12
	}
	var categories []string
	query := `
		WITH interest AS (
			SELECT l.category AS key, COUNT(*) AS weight
			FROM provider_favorites f
			INNER JOIN service_listings l ON l.id = f.listing_id
			WHERE f.user_uuid=$1
			GROUP BY l.category
			UNION ALL
			SELECT elem::text AS key, COUNT(*) AS weight
			FROM provider_search_history h,
			     LATERAL jsonb_array_elements_text(h.filters -> 'categories') elem
			WHERE h.user_uuid=$1
			GROUP BY elem
		)
		SELECT key
		FROM interest
		GROUP BY key
		ORDER BY SUM(weight) DESC
		LIMIT $2
	`
	if err := s.db.SelectContext(ctx, &categories, query, userUUID, limit); err != nil {
		return nil, err
	}
	if len(categories) == 0 {
		// fall back to top-rated listings overall
		return s.SearchPublicListings(ctx, SearchFilters{Limit: limit})
	}
	return s.SearchPublicListings(ctx, SearchFilters{
		Categories: categories,
		Limit:      limit,
	})
}
