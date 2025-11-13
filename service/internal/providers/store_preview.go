package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// GetListingPreview returns a listing and associated discovery metadata using its preview token.
func (s *Store) GetListingPreview(ctx context.Context, token string) (SearchResult, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return SearchResult{}, ErrListingNotFound
	}

	var (
		listingID      string
		userUUID       string
		title          string
		summary        sql.NullString
		description    sql.NullString
		category       string
		subcategory    sql.NullString
		pricingModel   string
		basePriceCents int64
		currency       string
		status         string
		previewToken   string
		publishedAt    sql.NullTime
		attributesJSON []byte
		createdAt      time.Time
		updatedAt      time.Time
		avgRating      sql.NullFloat64
		reviewCount    sql.NullInt64
		totalResponses sql.NullInt64
		jobsCompleted  sql.NullInt64
		avgRespMinutes sql.NullFloat64
		displayName    sql.NullString
		profileType    string
		location       sql.NullString
		areaRegion     sql.NullString
		areaCountry    sql.NullString
		areaLat        sql.NullFloat64
		areaLng        sql.NullFloat64
	)

	row := s.db.QueryRowContext(ctx, `
		SELECT
			l.id, l.user_uuid, l.title, l.summary, l.description, l.category, l.subcategory,
			l.pricing_model, l.base_price_cents, l.currency, l.status, l.preview_token, l.published_at, l.attributes,
			l.created_at, l.updated_at,
			COALESCE(r.avg_rating, 0) AS average_rating,
			COALESCE(r.review_count, 0) AS review_count,
			COALESCE(prs.total_responses, 0) AS total_responses,
			COALESCE(prs.jobs_completed, 0) AS jobs_completed,
			COALESCE(prs.average_minutes, 0) AS average_response_minutes,
			p.display_name,
			p.profile_type,
			p.location,
			area.region,
			area.country_code,
			area.latitude,
			area.longitude
		FROM service_listings l
		INNER JOIN profiles p ON p.user_uuid = l.user_uuid
		LEFT JOIN (
			SELECT user_uuid, AVG(rating)::float AS avg_rating, COUNT(*) AS review_count
			FROM profile_reviews
			GROUP BY user_uuid
		) r ON r.user_uuid = l.user_uuid
		LEFT JOIN provider_response_stats prs ON prs.user_uuid = l.user_uuid
		LEFT JOIN LATERAL (
			SELECT sa.region,
			       sa.country_code,
			       sa.latitude,
			       sa.longitude
			FROM service_areas sa
			WHERE sa.listing_id = l.id
			ORDER BY sa.created_at ASC
			LIMIT 1
		) area ON TRUE
		WHERE l.preview_token=$1 AND l.status <> 'archived'
	`, token)

	if err := row.Scan(
		&listingID,
		&userUUID,
		&title,
		&summary,
		&description,
		&category,
		&subcategory,
		&pricingModel,
		&basePriceCents,
		&currency,
		&status,
		&previewToken,
		&publishedAt,
		&attributesJSON,
		&createdAt,
		&updatedAt,
		&avgRating,
		&reviewCount,
		&totalResponses,
		&jobsCompleted,
		&avgRespMinutes,
		&displayName,
		&profileType,
		&location,
		&areaRegion,
		&areaCountry,
		&areaLat,
		&areaLng,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SearchResult{}, ErrListingNotFound
		}
		return SearchResult{}, err
	}

	attrs := map[string]any{}
	if len(attributesJSON) > 0 {
		if err := json.Unmarshal(attributesJSON, &attrs); err != nil {
			return SearchResult{}, err
		}
	}

	listing := Listing{
		ID:             listingID,
		UserUUID:       userUUID,
		Title:          title,
		Summary:        nullableStringPtr(summary),
		Description:    nullableStringPtr(description),
		Category:       category,
		Subcategory:    nullableStringPtr(subcategory),
		PricingModel:   pricingModel,
		BasePriceCents: basePriceCents,
		Currency:       currency,
		Status:         status,
		Attributes:     attrs,
		PreviewToken:   previewToken,
		PublishedAt:    nullableTimePtr(publishedAt),
		Media:          []MediaAsset{},
		Metrics:        ListingMetrics{},
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}

	listings, err := s.attachMedia(ctx, []Listing{listing})
	if err != nil {
		return SearchResult{}, err
	}
	listing = listings[0]

	result := SearchResult{
		Listing:     listing,
		DisplayName: nullableStringPtr(displayName),
		ProfileType: profileType,
		Location:    nullableStringPtr(location),
	}
	if avgRating.Valid {
		result.AverageRating = avgRating.Float64
	}
	if reviewCount.Valid {
		result.ReviewCount = int(reviewCount.Int64)
	}
	if totalResponses.Valid {
		resultScore := computeSearchScore(result, listing.UpdatedAt, totalResponses.Int64, jobsCompleted.Int64, avgRespMinutes.Float64, nil)
		result.Score = resultScore
	}
	if areaRegion.Valid {
		region := strings.TrimSpace(areaRegion.String)
		if region != "" {
			result.Location = &region
		}
	}
	if areaCountry.Valid {
		country := strings.TrimSpace(areaCountry.String)
		if country != "" {
			if result.Location == nil {
				result.Location = &country
			} else if !strings.Contains(*result.Location, country) {
				combined := strings.TrimSpace(*result.Location + ", " + country)
				result.Location = &combined
			}
		}
	}
	return result, nil
}
