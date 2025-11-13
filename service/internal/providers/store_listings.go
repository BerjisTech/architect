package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/microcosm-cc/bluemonday"
)

var (
	ErrListingNotFound = errors.New("providers: listing not found")
)

// Listing represents a provider service offering.
type Listing struct {
	ID             string         `json:"id"`
	UserUUID       string         `json:"userUuid"`
	Title          string         `json:"title"`
	Summary        *string        `json:"summary,omitempty"`
	Description    *string        `json:"description,omitempty"`
	Category       string         `json:"category"`
	Subcategory    *string        `json:"subcategory,omitempty"`
	PricingModel   string         `json:"pricingModel"`
	BasePriceCents int64          `json:"basePriceCents"`
	Currency       string         `json:"currency"`
	Status         string         `json:"status"`
	Attributes     map[string]any `json:"attributes"`
	PreviewToken   string         `json:"previewToken"`
	PublishedAt    *time.Time     `json:"publishedAt,omitempty"`
	Media          []MediaAsset   `json:"media"`
	Metrics        ListingMetrics `json:"metrics"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
}

// ListingInput captures data for creating or updating listings.
type ListingInput struct {
	Title          string         `json:"title"`
	Summary        *string        `json:"summary,omitempty"`
	Description    *string        `json:"description,omitempty"`
	Category       string         `json:"category"`
	Subcategory    *string        `json:"subcategory,omitempty"`
	PricingModel   string         `json:"pricingModel"`
	BasePriceCents int64          `json:"basePriceCents"`
	Currency       string         `json:"currency"`
	Status         string         `json:"status"`
	Attributes     map[string]any `json:"attributes"`
}

// SearchFilters describe discovery options for public listings.
type SearchFilters struct {
	Query         string
	Categories    []string
	Subcategories []string
	CountryCodes  []string
	Region        string
	MinPriceCents int64
	MaxPriceCents int64
	MinRating     float64
	Latitude      *float64
	Longitude     *float64
	RadiusKm      *float64
	DayOfWeek     *int
	StartMinute   *int
	EndMinute     *int
	Limit         int
	Offset        int
}

// SearchResult wraps a listing with enriched discovery metadata.
type SearchResult struct {
	Listing       Listing  `json:"listing"`
	DisplayName   *string  `json:"displayName,omitempty"`
	ProfileType   string   `json:"profileType"`
	Location      *string  `json:"location,omitempty"`
	AverageRating float64  `json:"averageRating"`
	ReviewCount   int      `json:"reviewCount"`
	DistanceKm    *float64 `json:"distanceKm,omitempty"`
	Score         float64  `json:"score"`
}

// AvailabilitySlot models weekly availability for a listing.
type AvailabilitySlot struct {
	ID          string    `json:"id"`
	ListingID   string    `json:"listingId"`
	DayOfWeek   int       `json:"dayOfWeek"`
	StartMinute int       `json:"startMinute"`
	EndMinute   int       `json:"endMinute"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ServiceArea models a geographic coverage entry.
type ServiceArea struct {
	ID          string    `json:"id"`
	ListingID   string    `json:"listingId"`
	Region      string    `json:"region"`
	CountryCode *string   `json:"countryCode,omitempty"`
	Latitude    *float64  `json:"latitude,omitempty"`
	Longitude   *float64  `json:"longitude,omitempty"`
	Notes       *string   `json:"notes,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Analytics summarises provider performance.
type Analytics struct {
	TotalListings          int     `json:"totalListings"`
	ActiveListings         int     `json:"activeListings"`
	AverageResponseMinutes float64 `json:"averageResponseMinutes"`
	TotalResponses         int     `json:"totalResponses"`
	JobsCompleted          int     `json:"jobsCompleted"`
}

// MediaAsset represents an uploaded media item (image/document) that belongs to a listing.
type MediaAsset struct {
	ID            string         `json:"id"`
	ListingID     string         `json:"listingId"`
	MediaType     string         `json:"mediaType"`
	Title         string         `json:"title"`
	Description   *string        `json:"description,omitempty"`
	URL           string         `json:"url"`
	PreviewURL    *string        `json:"previewUrl,omitempty"`
	FileName      *string        `json:"fileName,omitempty"`
	MimeType      *string        `json:"mimeType,omitempty"`
	FileSizeBytes int64          `json:"fileSizeBytes"`
	IsPrimary     bool           `json:"isPrimary"`
	Position      int            `json:"position"`
	Metadata      map[string]any `json:"metadata"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}

// ListingMetrics tracks engagement counters for a listing.
type ListingMetrics struct {
	ViewCount     int64      `json:"viewCount"`
	ContactCount  int64      `json:"contactCount"`
	LastViewedAt  *time.Time `json:"lastViewedAt,omitempty"`
	LastContactAt *time.Time `json:"lastContactAt,omitempty"`
}

func sanitizeListingInput(in ListingInput) ListingInput {
	in.Title = strings.TrimSpace(in.Title)
	in.Category = strings.TrimSpace(strings.ToLower(in.Category))
	if in.Category == "" {
		in.Category = "general"
	}
	if in.Summary != nil {
		trimmed := strings.TrimSpace(*in.Summary)
		if trimmed == "" {
			in.Summary = nil
		} else {
			copy := trimmed
			in.Summary = &copy
		}
	}
	if in.Description != nil {
		sanitized := sanitizeListingDescription(*in.Description)
		if sanitized == "" {
			in.Description = nil
		} else {
			copy := sanitized
			in.Description = &copy
		}
	}
	if in.Subcategory != nil {
		trimmed := strings.TrimSpace(strings.ToLower(*in.Subcategory))
		in.Subcategory = &trimmed
	}
	in.PricingModel = strings.ReplaceAll(strings.TrimSpace(strings.ToLower(in.PricingModel)), "-", "_")
	switch in.PricingModel {
	case "fixed", "hourly", "per_project":
	default:
		in.PricingModel = "fixed"
	}
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if len(in.Currency) == 0 {
		in.Currency = "USD"
	}
	in.Status = strings.TrimSpace(strings.ToLower(in.Status))
	switch in.Status {
	case "pending", "active", "inactive":
	default:
		in.Status = "pending"
	}
	if in.BasePriceCents < 0 {
		in.BasePriceCents = 0
	}
	if in.Attributes == nil {
		in.Attributes = map[string]any{}
	}
	return in
}

var listingDescriptionPolicy = newListingDescriptionPolicy()

func newListingDescriptionPolicy() *bluemonday.Policy {
	policy := bluemonday.StrictPolicy()
	policy.AllowElements("p", "br", "ul", "ol", "li", "strong", "em", "b", "i", "u", "blockquote", "a", "h2", "h3")
	policy.AllowAttrs("href", "target", "rel").OnElements("a")
	policy.AllowURLSchemes("http", "https", "mailto", "tel")
	policy.AllowRelativeURLs(true)
	policy.RequireNoFollowOnLinks(true)
	policy.AddTargetBlankToFullyQualifiedLinks(true)
	return policy
}

func sanitizeListingDescription(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	sanitized := listingDescriptionPolicy.Sanitize(trimmed)
	sanitized = strings.ReplaceAll(sanitized, "<div>", "<p>")
	sanitized = strings.ReplaceAll(sanitized, "</div>", "</p>")
	sanitized = strings.TrimSpace(strings.ReplaceAll(sanitized, "&nbsp;", " "))
	if sanitized == "" {
		return ""
	}
	return sanitized
}

func (s *Store) CreateListing(ctx context.Context, userUUID string, input ListingInput) (Listing, error) {
	input = sanitizeListingInput(input)
	now := time.Now().UTC()
	published := sql.NullTime{}
	if input.Status == "active" {
		published.Time = now
		published.Valid = true
	}
	category, subcategory, attributes, err := s.validateCategory(ctx, input.Category, input.Subcategory, input.Attributes)
	if err != nil {
		return Listing{}, err
	}
	attrsJSON, err := json.Marshal(attributes)
	if err != nil {
		return Listing{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO service_listings (user_uuid, title, summary, description, category, subcategory, pricing_model, base_price_cents, currency, status, published_at, attributes, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
		RETURNING id, user_uuid, title, summary, description, category, subcategory, pricing_model,
		          base_price_cents, currency, status, preview_token, published_at, attributes, created_at, updated_at
	`, userUUID, input.Title, nullable(input.Summary), nullable(input.Description), category, nullable(subcategory), input.PricingModel, input.BasePriceCents, input.Currency, input.Status, published, attrsJSON, now)
	return scanListing(row)
}

func (s *Store) UpdateListing(ctx context.Context, userUUID, listingID string, input ListingInput) (Listing, error) {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return Listing{}, err
	}
	input = sanitizeListingInput(input)
	now := time.Now().UTC()
	var (
		currentStatus    string
		currentPublished sql.NullTime
	)
	if err := s.db.QueryRowContext(ctx, `
		SELECT status, published_at
		FROM service_listings
		WHERE id=$1 AND user_uuid=$2
	`, listingID, userUUID).Scan(&currentStatus, &currentPublished); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Listing{}, ErrListingNotFound
		}
		return Listing{}, err
	}
	published := sql.NullTime{}
	if input.Status == "active" {
		if currentStatus == "active" && currentPublished.Valid {
			published = currentPublished
		} else {
			published.Time = now
			published.Valid = true
		}
	}
	category, subcategory, attributes, err := s.validateCategory(ctx, input.Category, input.Subcategory, input.Attributes)
	if err != nil {
		return Listing{}, err
	}
	attrsJSON, err := json.Marshal(attributes)
	if err != nil {
		return Listing{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE service_listings
		SET title=$1, summary=$2, description=$3, category=$4, subcategory=$5, pricing_model=$6,
		    base_price_cents=$7, currency=$8, status=$9, published_at=$10, attributes=$11, updated_at=$12
		WHERE id=$13 AND user_uuid=$14
		RETURNING id, user_uuid, title, summary, description, category, subcategory, pricing_model,
		          base_price_cents, currency, status, preview_token, published_at, attributes, created_at, updated_at
	`, input.Title, nullable(input.Summary), nullable(input.Description), category, nullable(subcategory), input.PricingModel, input.BasePriceCents, input.Currency, input.Status, published, attrsJSON, now, listingID, userUUID)
	return scanListing(row)
}

func (s *Store) DeleteListing(ctx context.Context, userUUID, listingID string) error {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM service_listings WHERE id=$1 AND user_uuid=$2`, listingID, userUUID)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return ErrListingNotFound
	}
	return nil
}

func (s *Store) ListListingsByUser(ctx context.Context, userUUID string) ([]Listing, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT id, user_uuid, title, summary, description, category, subcategory, pricing_model,
		       base_price_cents, currency, status, preview_token, published_at, attributes, created_at, updated_at
		FROM service_listings
		WHERE user_uuid=$1
		ORDER BY created_at DESC
	`, userUUID)
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
	return s.attachMedia(ctx, listings)
}

func (s *Store) ListPublicListings(ctx context.Context, limit int) ([]Listing, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryxContext(ctx, `
		SELECT id, user_uuid, title, summary, description, category, subcategory, pricing_model,
		       base_price_cents, currency, status, preview_token, published_at, attributes, created_at, updated_at
		FROM service_listings
		WHERE status='active'
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
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
	return s.attachMedia(ctx, listings)
}

// SearchPublicListings returns listings that satisfy the provided discovery filters.
func (s *Store) SearchPublicListings(ctx context.Context, filters SearchFilters) ([]SearchResult, error) {
	limit := filters.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := filters.Offset
	if offset < 0 {
		offset = 0
	}
	if filters.MaxPriceCents > 0 && filters.MinPriceCents > 0 && filters.MaxPriceCents < filters.MinPriceCents {
		filters.MinPriceCents, filters.MaxPriceCents = filters.MaxPriceCents, filters.MinPriceCents
	}
	if filters.DayOfWeek != nil {
		day := *filters.DayOfWeek
		if day < 0 || day > 6 {
			return nil, errors.New("categories: dayOfWeek must be between 0 and 6")
		}
		if filters.StartMinute != nil && (*filters.StartMinute < 0 || *filters.StartMinute > 1440) {
			return nil, errors.New("categories: startMinute must be between 0 and 1440")
		}
		if filters.EndMinute != nil && (*filters.EndMinute < 0 || *filters.EndMinute > 1440) {
			return nil, errors.New("categories: endMinute must be between 0 and 1440")
		}
		if filters.StartMinute != nil && filters.EndMinute != nil && *filters.StartMinute > *filters.EndMinute {
			start := *filters.StartMinute
			end := *filters.EndMinute
			filters.StartMinute = &end
			filters.EndMinute = &start
		}
	}

	var (
		args       []any
		conditions []string
	)

	latPlaceholder := "NULL"
	lngPlaceholder := "NULL"
	if filters.Latitude != nil && filters.Longitude != nil {
		args = append(args, *filters.Latitude)
		latPlaceholder = fmt.Sprintf("$%d", len(args))
		args = append(args, *filters.Longitude)
		lngPlaceholder = fmt.Sprintf("$%d", len(args))
	}

	baseQuery := strings.Builder{}
	baseQuery.WriteString(fmt.Sprintf(`
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
			area.longitude,
			area.distance_km
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
			       sa.longitude,
			       CASE
			           WHEN %s IS NULL OR %s IS NULL OR sa.latitude IS NULL OR sa.longitude IS NULL THEN NULL
			           ELSE 6371 * acos(
			               cos(radians(%s)) * cos(radians(sa.latitude)) *
			               cos(radians(sa.longitude) - radians(%s)) +
			               sin(radians(%s)) * sin(radians(sa.latitude))
			           )
			       END AS distance_km
			FROM service_areas sa
			WHERE sa.listing_id = l.id
			ORDER BY distance_km NULLS FIRST, sa.created_at ASC
			LIMIT 1
		) area ON TRUE
		WHERE l.status = 'active'
	`, latPlaceholder, lngPlaceholder, latPlaceholder, lngPlaceholder, latPlaceholder))

	if q := strings.TrimSpace(filters.Query); q != "" {
		args = append(args, q)
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf(`to_tsvector('simple', coalesce(l.title,'') || ' ' || coalesce(l.summary,'') || ' ' || coalesce(l.description,'')) @@ plainto_tsquery('simple', %s)`, placeholder))
	}

	if clause := appendStringList(&args, filters.Categories); clause != "" {
		conditions = append(conditions, fmt.Sprintf("l.category IN (%s)", clause))
	}
	if clause := appendStringList(&args, filters.Subcategories); clause != "" {
		conditions = append(conditions, fmt.Sprintf("l.subcategory IN (%s)", clause))
	}

	if filters.MinPriceCents > 0 {
		args = append(args, filters.MinPriceCents)
		conditions = append(conditions, fmt.Sprintf("l.base_price_cents >= $%d", len(args)))
	}
	if filters.MaxPriceCents > 0 {
		args = append(args, filters.MaxPriceCents)
		conditions = append(conditions, fmt.Sprintf("l.base_price_cents <= $%d", len(args)))
	}
	if filters.MinRating > 0 {
		args = append(args, filters.MinRating)
		conditions = append(conditions, fmt.Sprintf("COALESCE(r.avg_rating, 0) >= $%d", len(args)))
	}
	if strings.TrimSpace(filters.Region) != "" {
		args = append(args, strings.ToLower(strings.TrimSpace(filters.Region)))
		conditions = append(conditions, fmt.Sprintf(`EXISTS (SELECT 1 FROM service_areas sa WHERE sa.listing_id = l.id AND LOWER(sa.region) = $%d)`, len(args)))
	}
	if clause := appendStringList(&args, filters.CountryCodes); clause != "" {
		conditions = append(conditions, fmt.Sprintf(`EXISTS (SELECT 1 FROM service_areas sa WHERE sa.listing_id = l.id AND LOWER(sa.country_code) IN (%s))`, clause))
	}
	if filters.RadiusKm != nil {
		if filters.Latitude == nil || filters.Longitude == nil {
			return nil, errors.New("categories: radius requires latitude and longitude")
		}
		radius := *filters.RadiusKm
		if radius < 0 {
			radius = 0
		}
		args = append(args, radius)
		conditions = append(conditions, fmt.Sprintf("area.distance_km IS NOT NULL AND area.distance_km <= $%d", len(args)))
	}
	if filters.DayOfWeek != nil {
		args = append(args, *filters.DayOfWeek)
		dayPlaceholder := fmt.Sprintf("$%d", len(args))
		timeConditions := []string{fmt.Sprintf("sa.day_of_week = %s", dayPlaceholder)}
		if filters.StartMinute != nil {
			args = append(args, *filters.StartMinute)
			timeConditions = append(timeConditions, fmt.Sprintf("sa.start_minutes <= $%d", len(args)))
		}
		if filters.EndMinute != nil {
			args = append(args, *filters.EndMinute)
			timeConditions = append(timeConditions, fmt.Sprintf("sa.end_minutes >= $%d", len(args)))
		}
		conditions = append(conditions, fmt.Sprintf(`EXISTS (SELECT 1 FROM service_availability sa WHERE sa.listing_id = l.id AND %s)`, strings.Join(timeConditions, " AND ")))
	}

	if len(conditions) > 0 {
		baseQuery.WriteString(" AND ")
		baseQuery.WriteString(strings.Join(conditions, " AND "))
	}

	args = append(args, limit, offset)
	baseQuery.WriteString(fmt.Sprintf(" ORDER BY COALESCE(r.avg_rating, 0) DESC, l.updated_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args)))

	rows, err := s.db.QueryxContext(ctx, baseQuery.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
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
			distanceKm     sql.NullFloat64
		)
		if err := rows.Scan(
			&listingID, &userUUID, &title, &summary, &description, &category, &subcategory,
			&pricingModel, &basePriceCents, &currency, &status, &previewToken, &publishedAt, &attributesJSON, &createdAt, &updatedAt,
			&avgRating, &reviewCount, &totalResponses, &jobsCompleted, &avgRespMinutes,
			&displayName, &profileType, &location,
			&areaRegion, &areaCountry, &areaLat, &areaLng, &distanceKm,
		); err != nil {
			return nil, err
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
			PreviewToken:   previewToken,
			PublishedAt:    nullableTimePtr(publishedAt),
			CreatedAt:      createdAt,
			UpdatedAt:      updatedAt,
			Attributes:     map[string]any{},
			Media:          []MediaAsset{},
			Metrics:        ListingMetrics{},
		}
		if len(attributesJSON) > 0 {
			var attrs map[string]any
			if err := json.Unmarshal(attributesJSON, &attrs); err == nil && attrs != nil {
				listing.Attributes = attrs
			}
		}
		result := SearchResult{
			Listing:       listing,
			DisplayName:   nil,
			ProfileType:   profileType,
			Location:      nil,
			AverageRating: 0,
			ReviewCount:   0,
			DistanceKm:    nil,
			Score:         0,
		}
		if displayName.Valid {
			name := strings.TrimSpace(displayName.String)
			if name != "" {
				result.DisplayName = &name
			}
		}
		if avgRating.Valid {
			result.AverageRating = avgRating.Float64
		}
		if reviewCount.Valid {
			result.ReviewCount = int(reviewCount.Int64)
		}
		if distanceKm.Valid {
			d := distanceKm.Float64
			result.DistanceKm = &d
		}
		if areaRegion.Valid && strings.TrimSpace(areaRegion.String) != "" {
			region := strings.TrimSpace(areaRegion.String)
			if areaCountry.Valid && strings.TrimSpace(areaCountry.String) != "" {
				country := strings.TrimSpace(areaCountry.String)
				loc := region
				if country != "" {
					loc = region + ", " + country
				}
				result.Location = &loc
			} else {
				loc := region
				result.Location = &loc
			}
		} else if location.Valid {
			loc := strings.TrimSpace(location.String)
			if loc != "" {
				result.Location = &loc
			}
		}

		score := computeSearchScore(result, updatedAt, totalResponses.Int64, jobsCompleted.Int64, avgRespMinutes.Float64, result.DistanceKm)
		result.Score = score

		results = append(results, result)
	}
	return results, rows.Err()
}
func (s *Store) GetAvailability(ctx context.Context, listingID string) ([]AvailabilitySlot, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT id, listing_id, day_of_week, start_minutes, end_minutes, created_at, updated_at
		FROM service_availability
		WHERE listing_id=$1
		ORDER BY day_of_week ASC, start_minutes ASC
	`, listingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var slots []AvailabilitySlot
	for rows.Next() {
		var slot AvailabilitySlot
		if err := rows.Scan(&slot.ID, &slot.ListingID, &slot.DayOfWeek, &slot.StartMinute, &slot.EndMinute, &slot.CreatedAt, &slot.UpdatedAt); err != nil {
			return nil, err
		}
		slots = append(slots, slot)
	}
	return slots, nil
}

func (s *Store) SetAvailability(ctx context.Context, listingID, userUUID string, slots []AvailabilitySlot) error {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return err
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM service_availability WHERE listing_id=$1`, listingID); err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, slot := range slots {
		if slot.DayOfWeek < 0 || slot.DayOfWeek > 6 {
			return errors.New("providers: invalid day_of_week")
		}
		if slot.StartMinute < 0 || slot.EndMinute > 24*60 || slot.StartMinute >= slot.EndMinute {
			return errors.New("providers: invalid availability window")
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO service_availability (listing_id, day_of_week, start_minutes, end_minutes, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$5)
		`, listingID, slot.DayOfWeek, slot.StartMinute, slot.EndMinute, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) GetServiceAreas(ctx context.Context, listingID string) ([]ServiceArea, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT id, listing_id, region, country_code, latitude, longitude, notes, created_at, updated_at
		FROM service_areas
		WHERE listing_id=$1
		ORDER BY created_at ASC
	`, listingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var areas []ServiceArea
	for rows.Next() {
		var (
			id          string
			lid         string
			region      string
			countryCode sql.NullString
			latitude    sql.NullFloat64
			longitude   sql.NullFloat64
			notes       sql.NullString
			createdAt   time.Time
			updatedAt   time.Time
		)
		if err := rows.Scan(&id, &lid, &region, &countryCode, &latitude, &longitude, &notes, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		var latPtr, lngPtr *float64
		if latitude.Valid {
			value := latitude.Float64
			latPtr = &value
		}
		if longitude.Valid {
			value := longitude.Float64
			lngPtr = &value
		}
		areas = append(areas, ServiceArea{
			ID:          id,
			ListingID:   lid,
			Region:      region,
			CountryCode: nullableStringPtr(countryCode),
			Latitude:    latPtr,
			Longitude:   lngPtr,
			Notes:       nullableStringPtr(notes),
			CreatedAt:   createdAt,
			UpdatedAt:   updatedAt,
		})
	}
	return areas, nil
}

func (s *Store) SetServiceAreas(ctx context.Context, listingID, userUUID string, areas []ServiceArea) error {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return err
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM service_areas WHERE listing_id=$1`, listingID); err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, area := range areas {
		region := strings.TrimSpace(area.Region)
		if region == "" {
			return errors.New("providers: region is required")
		}
		country := ""
		if area.CountryCode != nil {
			country = strings.ToUpper(strings.TrimSpace(*area.CountryCode))
		}
		var latPtr, lngPtr any
		if area.Latitude != nil && area.Longitude != nil {
			lat := *area.Latitude
			lng := *area.Longitude
			if lat < -90 || lat > 90 {
				return errors.New("providers: latitude must be between -90 and 90")
			}
			if lng < -180 || lng > 180 {
				return errors.New("providers: longitude must be between -180 and 180")
			}
			latPtr = lat
			lngPtr = lng
		}
		notes := nullable(area.Notes)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO service_areas (listing_id, region, country_code, latitude, longitude, notes, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
		`, listingID, region, nullable(&country), latPtr, lngPtr, notes, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) RecordResponse(ctx context.Context, userUUID string, elapsedMinutes float64, jobCompleted bool) error {
	if elapsedMinutes < 0 {
		elapsedMinutes = 0
	}
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `
		UPDATE provider_response_stats
		SET total_responses = total_responses + 1,
		    average_minutes = CASE
				WHEN total_responses = 0 THEN $2
				ELSE ((average_minutes * total_responses) + $2) / (total_responses + 1)
			END,
		    jobs_completed = jobs_completed + CASE WHEN $3 THEN 1 ELSE 0 END,
		    last_response_at = $4,
		    updated_at = $4
		WHERE user_uuid = $1
	`, userUUID, elapsedMinutes, jobCompleted, now)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO provider_response_stats (user_uuid, total_responses, average_minutes, jobs_completed, last_response_at, updated_at)
			VALUES ($1, 1, $2, CASE WHEN $3 THEN 1 ELSE 0 END, $4, $4)
		`, userUUID, elapsedMinutes, jobCompleted, now)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetAnalytics(ctx context.Context, userUUID string) (Analytics, error) {
	var analytics Analytics
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_listings WHERE user_uuid=$1`, userUUID).Scan(&analytics.TotalListings); err != nil {
		return analytics, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_listings WHERE user_uuid=$1 AND status='active'`, userUUID).Scan(&analytics.ActiveListings); err != nil {
		return analytics, err
	}
	var (
		totalResponses sql.NullInt64
		avgMinutes     sql.NullFloat64
		jobs           sql.NullInt64
	)
	if err := s.db.QueryRowContext(ctx, `
		SELECT total_responses, average_minutes, jobs_completed
		FROM provider_response_stats
		WHERE user_uuid=$1
	`, userUUID).Scan(&totalResponses, &avgMinutes, &jobs); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return analytics, err
		}
	} else {
		if avgMinutes.Valid {
			analytics.AverageResponseMinutes = avgMinutes.Float64
		}
		if totalResponses.Valid {
			analytics.TotalResponses = int(totalResponses.Int64)
		}
		if jobs.Valid {
			analytics.JobsCompleted = int(jobs.Int64)
		}
	}
	return analytics, nil
}

func (s *Store) ensureListingOwner(ctx context.Context, listingID, userUUID string) error {
	var exists bool
	err := s.db.GetContext(ctx, &exists, `
		SELECT EXISTS(SELECT 1 FROM service_listings WHERE id=$1 AND user_uuid=$2)
	`, listingID, userUUID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrListingNotFound
	}
	return nil
}

// EnsureListingOwner exposes listing ownership checks for consumers (e.g., HTTP handlers).
func (s *Store) EnsureListingOwner(ctx context.Context, listingID, userUUID string) error {
	return s.ensureListingOwner(ctx, listingID, userUUID)
}

func scanListing(row interface {
	Scan(dest ...any) error
}) (Listing, error) {
	var (
		id             string
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
	)
	if err := row.Scan(&id, &userUUID, &title, &summary, &description, &category, &subcategory, &pricingModel, &basePriceCents, &currency, &status, &previewToken, &publishedAt, &attributesJSON, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Listing{}, ErrListingNotFound
		}
		return Listing{}, err
	}
	attrs := map[string]any{}
	if len(attributesJSON) > 0 {
		if err := json.Unmarshal(attributesJSON, &attrs); err != nil {
			return Listing{}, err
		}
	}
	return Listing{
		ID:             id,
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
	}, nil
}

func nullableStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	trimmed := strings.TrimSpace(value.String)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func nullableTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	t := value.Time
	return &t
}

func appendStringList(args *[]any, values []string) string {
	if len(values) == 0 {
		return ""
	}
	placeholders := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(strings.ToLower(value))
		if trimmed == "" {
			continue
		}
		*args = append(*args, trimmed)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(*args)))
	}
	if len(placeholders) == 0 {
		return ""
	}
	return strings.Join(placeholders, ",")
}

func (s *Store) validateCategory(ctx context.Context, category string, subcategory *string, attrs map[string]any) (string, *string, map[string]any, error) {
	if s.cats == nil {
		return category, subcategory, attrs, nil
	}
	selectedSub := ""
	if subcategory != nil {
		selectedSub = *subcategory
	}
	catDef, subDef, sanitized, err := s.cats.ValidateListingMetadata(ctx, category, selectedSub, attrs)
	if err != nil {
		return "", nil, nil, err
	}
	var subPtr *string
	if subDef.Key != "" {
		key := subDef.Key
		subPtr = &key
	}
	return catDef.Key, subPtr, sanitized, nil
}

func computeSearchScore(result SearchResult, updatedAt time.Time, totalResponses, jobsCompleted int64, avgResponseMinutes float64, distanceKm *float64) float64 {
	ratingScore := 0.0
	if result.AverageRating > 0 {
		ratingScore = math.Min(result.AverageRating/5.0, 1.0)
	}
	responseScore := math.Min(float64(totalResponses)/50.0, 1.0)
	jobsScore := math.Min(float64(jobsCompleted)/100.0, 1.0)
	responsiveness := 0.0
	if avgResponseMinutes > 0 {
		responsiveness = 1 / (1 + (avgResponseMinutes / 60.0))
	}
	recencyDays := time.Since(updatedAt).Hours() / 24.0
	if recencyDays < 0 {
		recencyDays = 0
	}
	recencyScore := 1 / (1 + recencyDays/7.0)
	distancePenalty := 0.0
	if distanceKm != nil && *distanceKm >= 0 {
		distancePenalty = math.Min(*distanceKm/200.0, 1.0)
	}
	score := (0.45 * ratingScore) +
		(0.15 * responseScore) +
		(0.1 * jobsScore) +
		(0.1 * responsiveness) +
		(0.2 * recencyScore) -
		(0.1 * distancePenalty)
	if score < 0 {
		return 0
	}
	if score > 1 {
		return 1
	}
	return score
}
