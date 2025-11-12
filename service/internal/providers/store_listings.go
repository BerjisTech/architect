package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
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
	DayOfWeek     *int
	StartMinute   *int
	EndMinute     *int
	Limit         int
	Offset        int
}

// SearchResult wraps a listing with enriched discovery metadata.
type SearchResult struct {
	Listing       Listing `json:"listing"`
	DisplayName   *string `json:"displayName,omitempty"`
	ProfileType   string  `json:"profileType"`
	Location      *string `json:"location,omitempty"`
	AverageRating float64 `json:"averageRating"`
	ReviewCount   int     `json:"reviewCount"`
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

func sanitizeListingInput(in ListingInput) ListingInput {
	in.Title = strings.TrimSpace(in.Title)
	in.Category = strings.TrimSpace(strings.ToLower(in.Category))
	if in.Category == "" {
		in.Category = "general"
	}
	if in.Subcategory != nil {
		trimmed := strings.TrimSpace(strings.ToLower(*in.Subcategory))
		in.Subcategory = &trimmed
	}
	in.PricingModel = strings.TrimSpace(strings.ToLower(in.PricingModel))
	switch in.PricingModel {
	case "fixed", "hourly", "quote":
	default:
		in.PricingModel = "fixed"
	}
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if len(in.Currency) == 0 {
		in.Currency = "USD"
	}
	in.Status = strings.TrimSpace(strings.ToLower(in.Status))
	switch in.Status {
	case "draft", "active", "archived":
	default:
		in.Status = "draft"
	}
	if in.BasePriceCents < 0 {
		in.BasePriceCents = 0
	}
	if in.Attributes == nil {
		in.Attributes = map[string]any{}
	}
	return in
}

func (s *Store) CreateListing(ctx context.Context, userUUID string, input ListingInput) (Listing, error) {
	input = sanitizeListingInput(input)
	now := time.Now().UTC()
	category, subcategory, attributes, err := s.validateCategory(ctx, input.Category, input.Subcategory, input.Attributes)
	if err != nil {
		return Listing{}, err
	}
	attrsJSON, err := json.Marshal(attributes)
	if err != nil {
		return Listing{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO service_listings (user_uuid, title, summary, description, category, subcategory, pricing_model, base_price_cents, currency, status, attributes, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
		RETURNING id, user_uuid, title, summary, description, category, subcategory, pricing_model, base_price_cents, currency, status, attributes, created_at, updated_at
	`, userUUID, input.Title, nullable(input.Summary), nullable(input.Description), category, nullable(subcategory), input.PricingModel, input.BasePriceCents, input.Currency, input.Status, attrsJSON, now)
	return scanListing(row)
}

func (s *Store) UpdateListing(ctx context.Context, userUUID, listingID string, input ListingInput) (Listing, error) {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return Listing{}, err
	}
	input = sanitizeListingInput(input)
	now := time.Now().UTC()
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
		    base_price_cents=$7, currency=$8, status=$9, attributes=$10, updated_at=$11
		WHERE id=$12 AND user_uuid=$13
		RETURNING id, user_uuid, title, summary, description, category, subcategory, pricing_model, base_price_cents, currency, status, attributes, created_at, updated_at
	`, input.Title, nullable(input.Summary), nullable(input.Description), category, nullable(subcategory), input.PricingModel, input.BasePriceCents, input.Currency, input.Status, attrsJSON, now, listingID, userUUID)
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
		SELECT id, user_uuid, title, summary, description, category, subcategory, pricing_model, base_price_cents, currency, status, attributes, created_at, updated_at
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
	return listings, nil
}

func (s *Store) ListPublicListings(ctx context.Context, limit int) ([]Listing, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryxContext(ctx, `
		SELECT id, user_uuid, title, summary, description, category, subcategory, pricing_model, base_price_cents, currency, status, attributes, created_at, updated_at
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
	return listings, nil
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

	baseQuery := strings.Builder{}
	baseQuery.WriteString(`
		SELECT
			l.id, l.user_uuid, l.title, l.summary, l.description, l.category, l.subcategory,
			l.pricing_model, l.base_price_cents, l.currency, l.status, l.attributes,
			l.created_at, l.updated_at,
			COALESCE(r.avg_rating, 0) AS average_rating,
			COALESCE(r.review_count, 0) AS review_count,
			p.display_name,
			p.profile_type,
			p.location
		FROM service_listings l
		INNER JOIN profiles p ON p.user_uuid = l.user_uuid
		LEFT JOIN (
			SELECT user_uuid, AVG(rating)::float AS avg_rating, COUNT(*) AS review_count
			FROM profile_reviews
			GROUP BY user_uuid
		) r ON r.user_uuid = l.user_uuid
		WHERE l.status = 'active'
	`)

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
			attributesJSON []byte
			createdAt      time.Time
			updatedAt      time.Time
			avgRating      sql.NullFloat64
			reviewCount    sql.NullInt64
			displayName    sql.NullString
			profileType    string
			location       sql.NullString
		)
		if err := rows.Scan(
			&listingID, &userUUID, &title, &summary, &description, &category, &subcategory,
			&pricingModel, &basePriceCents, &currency, &status, &attributesJSON, &createdAt, &updatedAt,
			&avgRating, &reviewCount, &displayName, &profileType, &location,
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
			CreatedAt:      createdAt,
			UpdatedAt:      updatedAt,
			Attributes:     map[string]any{},
		}
		if len(attributesJSON) > 0 {
			var attrs map[string]any
			if err := json.Unmarshal(attributesJSON, &attrs); err == nil && attrs != nil {
				listing.Attributes = attrs
			}
		}
		result := SearchResult{
			Listing:       listing,
			DisplayName:   nullableStringPtr(displayName),
			ProfileType:   profileType,
			Location:      nullableStringPtr(location),
			AverageRating: 0,
			ReviewCount:   0,
		}
		if avgRating.Valid {
			result.AverageRating = avgRating.Float64
		}
		if reviewCount.Valid {
			result.ReviewCount = int(reviewCount.Int64)
		}
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
		SELECT id, listing_id, region, country_code, notes, created_at, updated_at
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
			notes       sql.NullString
			createdAt   time.Time
			updatedAt   time.Time
		)
		if err := rows.Scan(&id, &lid, &region, &countryCode, &notes, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		areas = append(areas, ServiceArea{
			ID:          id,
			ListingID:   lid,
			Region:      region,
			CountryCode: nullableStringPtr(countryCode),
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
		notes := nullable(area.Notes)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO service_areas (listing_id, region, country_code, notes, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$5)
		`, listingID, region, nullable(&country), notes, now); err != nil {
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
		attributesJSON []byte
		createdAt      time.Time
		updatedAt      time.Time
	)
	if err := row.Scan(&id, &userUUID, &title, &summary, &description, &category, &subcategory, &pricingModel, &basePriceCents, &currency, &status, &attributesJSON, &createdAt, &updatedAt); err != nil {
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
