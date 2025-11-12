package profile

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrSelfReview            = errors.New("profile: cannot review own profile")
	ErrDuplicateReview       = errors.New("profile: review already exists")
	ErrReviewNotFound        = errors.New("profile: review not found")
	ErrPortfolioNotFound     = errors.New("profile: portfolio item not found")
	ErrCertificationNotFound = errors.New("profile: certification not found")
)

func (s *Store) populateProfile(ctx context.Context, p *Profile, publicOnly bool) error {
	if portfolio, err := s.ListPortfolio(ctx, p.UserUUID, publicOnly); err == nil {
		p.Portfolio = portfolio
	} else {
		p.Portfolio = []PortfolioItem{}
	}
	if certs, err := s.ListCertifications(ctx, p.UserUUID, publicOnly); err == nil {
		p.Certifications = certs
	} else {
		p.Certifications = []Certification{}
	}
	if summary, err := s.reviewSummary(ctx, p.UserUUID, publicOnly); err == nil {
		p.ReviewSummary = summary
	}
	return nil
}

func (s *Store) ListPortfolio(ctx context.Context, userUUID string, publicOnly bool) ([]PortfolioItem, error) {
	query := `
		SELECT id, user_uuid, title, description, media_url, tags, is_public, position, created_at, updated_at
		FROM profile_portfolio_items
		WHERE user_uuid = $1
	`
	args := []any{userUUID}
	if publicOnly {
		query += ` AND is_public = TRUE`
	}
	query += ` ORDER BY position ASC, created_at ASC`

	rows, err := s.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []PortfolioItem
	for rows.Next() {
		var (
			id          string
			userID      string
			title       string
			description sql.NullString
			mediaURL    sql.NullString
			tags        pq.StringArray
			isPublic    bool
			position    int
			createdAt   time.Time
			updatedAt   time.Time
		)
		if err := rows.Scan(&id, &userID, &title, &description, &mediaURL, &tags, &isPublic, &position, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		items = append(items, PortfolioItem{
			ID:          id,
			UserUUID:    userID,
			Title:       title,
			Description: nullableStringPtr(description),
			MediaURL:    nullableStringPtr(mediaURL),
			Tags:        copyStringSlice(tags),
			IsPublic:    isPublic,
			Position:    position,
			CreatedAt:   createdAt,
			UpdatedAt:   updatedAt,
		})
	}
	return items, nil
}

func (s *Store) SavePortfolioItem(ctx context.Context, userUUID string, input PortfolioInput) (PortfolioItem, error) {
	now := time.Now().UTC()
	isPublic := true
	if input.IsPublic != nil {
		isPublic = *input.IsPublic
	}
	position := 0
	if input.Position != nil {
		position = *input.Position
	}
	tags := pq.StringArray(normalizeList(input.Tags))

	var (
		id          string
		userID      string
		title       string
		description sql.NullString
		mediaURL    sql.NullString
		tagValues   pq.StringArray
		publicFlag  bool
		pos         int
		createdAt   time.Time
		updatedAt   time.Time
	)
	if input.ID == nil || strings.TrimSpace(*input.ID) == "" {
		query := `
			INSERT INTO profile_portfolio_items (user_uuid, title, description, media_url, tags, is_public, position, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
			RETURNING id, user_uuid, title, description, media_url, tags, is_public, position, created_at, updated_at
		`
		if err := s.db.QueryRowxContext(ctx, query,
			userUUID,
			strings.TrimSpace(input.Title),
			nullable(input.Description),
			nullable(input.MediaURL),
			tags,
			isPublic,
			position,
			now,
		).Scan(&id, &userID, &title, &description, &mediaURL, &tagValues, &publicFlag, &pos, &createdAt, &updatedAt); err != nil {
			return PortfolioItem{}, err
		}
	} else {
		query := `
			UPDATE profile_portfolio_items
			SET title=$1, description=$2, media_url=$3, tags=$4, is_public=$5, position=$6, updated_at=$7
			WHERE user_uuid=$8 AND id=$9
			RETURNING id, user_uuid, title, description, media_url, tags, is_public, position, created_at, updated_at
		`
		if err := s.db.QueryRowxContext(ctx, query,
			strings.TrimSpace(input.Title),
			nullable(input.Description),
			nullable(input.MediaURL),
			tags,
			isPublic,
			position,
			now,
			userUUID,
			strings.TrimSpace(*input.ID),
		).Scan(&id, &userID, &title, &description, &mediaURL, &tagValues, &publicFlag, &pos, &createdAt, &updatedAt); err != nil {
			return PortfolioItem{}, err
		}
	}

	return PortfolioItem{
		ID:          id,
		UserUUID:    userID,
		Title:       title,
		Description: nullableStringPtr(description),
		MediaURL:    nullableStringPtr(mediaURL),
		Tags:        copyStringSlice([]string(tagValues)),
		IsPublic:    publicFlag,
		Position:    pos,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}, nil
}

func (s *Store) DeletePortfolioItem(ctx context.Context, userUUID, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM profile_portfolio_items WHERE user_uuid=$1 AND id=$2`, userUUID, id)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return ErrPortfolioNotFound
	}
	return nil
}

func (s *Store) ListCertifications(ctx context.Context, userUUID string, publicOnly bool) ([]Certification, error) {
	query := `
		SELECT id, user_uuid, name, issuer, issued_on, expires_on, credential_id, credential_url,
		       status, reviewed_by, reviewed_at, created_at, updated_at
		FROM profile_certifications
		WHERE user_uuid = $1
	`
	args := []any{userUUID}
	if publicOnly {
		query += ` AND status = 'approved'`
	}
	query += ` ORDER BY created_at DESC`

	rows, err := s.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Certification
	for rows.Next() {
		var (
			id            string
			userID        string
			name          string
			issuer        sql.NullString
			issuedOn      sql.NullTime
			expiresOn     sql.NullTime
			credentialID  sql.NullString
			credentialURL sql.NullString
			status        string
			reviewedBy    sql.NullString
			reviewedAt    sql.NullTime
			createdAt     time.Time
			updatedAt     time.Time
		)
		if err := rows.Scan(&id, &userID, &name, &issuer, &issuedOn, &expiresOn, &credentialID, &credentialURL,
			&status, &reviewedBy, &reviewedAt, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		items = append(items, Certification{
			ID:            id,
			UserUUID:      userID,
			Name:          name,
			Issuer:        nullableStringPtr(issuer),
			IssuedOn:      nullableTimePtr(issuedOn),
			ExpiresOn:     nullableTimePtr(expiresOn),
			CredentialID:  nullableStringPtr(credentialID),
			CredentialURL: nullableStringPtr(credentialURL),
			Status:        status,
			ReviewedBy:    nullableStringPtr(reviewedBy),
			ReviewedAt:    nullableTimePtr(reviewedAt),
			CreatedAt:     createdAt,
			UpdatedAt:     updatedAt,
		})
	}
	return items, nil
}

func (s *Store) SaveCertification(ctx context.Context, userUUID string, input CertificationInput) (Certification, error) {
	now := time.Now().UTC()

	var (
		id            string
		userID        string
		name          string
		issuer        sql.NullString
		issuedOn      sql.NullTime
		expiresOn     sql.NullTime
		credentialID  sql.NullString
		credentialURL sql.NullString
		status        string
		reviewedBy    sql.NullString
		reviewedAt    sql.NullTime
		createdAt     time.Time
		updatedAt     time.Time
	)
	if input.ID == nil || strings.TrimSpace(*input.ID) == "" {
		query := `
			INSERT INTO profile_certifications (user_uuid, name, issuer, issued_on, expires_on, credential_id, credential_url, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
			RETURNING id, user_uuid, name, issuer, issued_on, expires_on, credential_id, credential_url,
			          status, reviewed_by, reviewed_at, created_at, updated_at
		`
		if err := s.db.QueryRowxContext(ctx, query,
			userUUID,
			strings.TrimSpace(input.Name),
			nullable(input.Issuer),
			nullableTime(input.IssuedOn),
			nullableTime(input.ExpiresOn),
			nullable(input.CredentialID),
			nullable(input.CredentialURL),
			now,
		).Scan(
			&id, &userID, &name, &issuer, &issuedOn, &expiresOn, &credentialID, &credentialURL,
			&status, &reviewedBy, &reviewedAt, &createdAt, &updatedAt,
		); err != nil {
			return Certification{}, err
		}
	} else {
		query := `
			UPDATE profile_certifications
			SET name=$1, issuer=$2, issued_on=$3, expires_on=$4, credential_id=$5, credential_url=$6, status='pending', reviewed_by=NULL, reviewed_at=NULL, updated_at=$7
			WHERE user_uuid=$8 AND id=$9
			RETURNING id, user_uuid, name, issuer, issued_on, expires_on, credential_id, credential_url,
			          status, reviewed_by, reviewed_at, created_at, updated_at
		`
		if err := s.db.QueryRowxContext(ctx, query,
			strings.TrimSpace(input.Name),
			nullable(input.Issuer),
			nullableTime(input.IssuedOn),
			nullableTime(input.ExpiresOn),
			nullable(input.CredentialID),
			nullable(input.CredentialURL),
			now,
			userUUID,
			strings.TrimSpace(*input.ID),
		).Scan(
			&id, &userID, &name, &issuer, &issuedOn, &expiresOn, &credentialID, &credentialURL,
			&status, &reviewedBy, &reviewedAt, &createdAt, &updatedAt,
		); err != nil {
			return Certification{}, err
		}
	}

	return Certification{
		ID:            id,
		UserUUID:      userID,
		Name:          name,
		Issuer:        nullableStringPtr(issuer),
		IssuedOn:      nullableTimePtr(issuedOn),
		ExpiresOn:     nullableTimePtr(expiresOn),
		CredentialID:  nullableStringPtr(credentialID),
		CredentialURL: nullableStringPtr(credentialURL),
		Status:        status,
		ReviewedBy:    nullableStringPtr(reviewedBy),
		ReviewedAt:    nullableTimePtr(reviewedAt),
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}, nil
}

func (s *Store) DeleteCertification(ctx context.Context, userUUID, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM profile_certifications WHERE user_uuid=$1 AND id=$2`, userUUID, id)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return ErrCertificationNotFound
	}
	return nil
}

func (s *Store) UpdateCertificationStatus(ctx context.Context, userUUID, certificationID, reviewerUUID, status string, notes *string) (Certification, error) {
	status = strings.ToLower(strings.TrimSpace(status))
	if !isValidCertificationStatus(status) {
		return Certification{}, errors.New("profile: invalid certification status")
	}
	now := time.Now().UTC()

	query := `
		UPDATE profile_certifications
		SET status=$1, reviewed_by=$2, reviewed_at=$3, updated_at=$3
		WHERE user_uuid=$4 AND id=$5
		RETURNING id, user_uuid, name, issuer, issued_on, expires_on, credential_id, credential_url,
		          status, reviewed_by, reviewed_at, created_at, updated_at
	`
	var (
		id            string
		userID        string
		name          string
		issuer        sql.NullString
		issuedOn      sql.NullTime
		expiresOn     sql.NullTime
		credentialID  sql.NullString
		credentialURL sql.NullString
		statusOut     string
		reviewedBy    sql.NullString
		reviewedAt    sql.NullTime
		createdAt     time.Time
		updatedAt     time.Time
	)
	if err := s.db.QueryRowxContext(ctx, query, status, reviewerUUID, now, userUUID, certificationID).Scan(
		&id, &userID, &name, &issuer, &issuedOn, &expiresOn, &credentialID, &credentialURL,
		&statusOut, &reviewedBy, &reviewedAt, &createdAt, &updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Certification{}, ErrCertificationNotFound
		}
		return Certification{}, err
	}
	return Certification{
		ID:            id,
		UserUUID:      userID,
		Name:          name,
		Issuer:        nullableStringPtr(issuer),
		IssuedOn:      nullableTimePtr(issuedOn),
		ExpiresOn:     nullableTimePtr(expiresOn),
		CredentialID:  nullableStringPtr(credentialID),
		CredentialURL: nullableStringPtr(credentialURL),
		Status:        statusOut,
		ReviewedBy:    nullableStringPtr(reviewedBy),
		ReviewedAt:    nullableTimePtr(reviewedAt),
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}, nil
}

func (s *Store) ListReviews(ctx context.Context, userUUID string, publicOnly bool) ([]Review, error) {
	query := `
		SELECT id, user_uuid, reviewer_uuid, rating, title, comment, is_public, created_at, updated_at
		FROM profile_reviews
		WHERE user_uuid = $1
	`
	args := []any{userUUID}
	if publicOnly {
		query += ` AND is_public = TRUE`
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Review
	for rows.Next() {
		var (
			id           string
			userID       string
			reviewerUUID string
			rating       int
			title        sql.NullString
			comment      sql.NullString
			isPublic     bool
			createdAt    time.Time
			updatedAt    time.Time
		)
		if err := rows.Scan(&id, &userID, &reviewerUUID, &rating, &title, &comment, &isPublic, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		items = append(items, Review{
			ID:           id,
			UserUUID:     userID,
			ReviewerUUID: reviewerUUID,
			Rating:       rating,
			Title:        nullableStringPtr(title),
			Comment:      nullableStringPtr(comment),
			IsPublic:     isPublic,
			CreatedAt:    createdAt,
			UpdatedAt:    updatedAt,
		})
	}
	return items, nil
}

func (s *Store) CreateReview(ctx context.Context, subjectUUID, reviewerUUID string, input ReviewInput) (Review, error) {
	if subjectUUID == reviewerUUID {
		return Review{}, ErrSelfReview
	}
	if input.Rating < 1 || input.Rating > 5 {
		return Review{}, errors.New("profile: rating must be between 1 and 5")
	}
	isPublic := true
	if input.IsPublic != nil {
		isPublic = *input.IsPublic
	}

	query := `
		INSERT INTO profile_reviews (user_uuid, reviewer_uuid, rating, title, comment, is_public, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, now(), now())
		RETURNING id, user_uuid, reviewer_uuid, rating, title, comment, is_public, created_at, updated_at
	`
	row := s.db.QueryRowxContext(ctx, query, subjectUUID, reviewerUUID, input.Rating,
		nullable(input.Title), nullable(input.Comment), isPublic)
	var review Review
	if err := row.Scan(&review.ID, &review.UserUUID, &review.ReviewerUUID, &review.Rating,
		&review.Title, &review.Comment, &review.IsPublic, &review.CreatedAt, &review.UpdatedAt); err != nil {
		if strings.Contains(err.Error(), "profile_reviews_unique") {
			return Review{}, ErrDuplicateReview
		}
		return Review{}, err
	}
	return review, nil
}

func (s *Store) DeleteReview(ctx context.Context, subjectUUID, reviewerUUID, reviewID string, allowAdmin bool) error {
	query := `DELETE FROM profile_reviews WHERE user_uuid=$1 AND id=$2`
	args := []any{subjectUUID, reviewID}
	if !allowAdmin {
		query += ` AND reviewer_uuid=$3`
		args = append(args, reviewerUUID)
	}
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return ErrReviewNotFound
	}
	return nil
}

func (s *Store) reviewSummary(ctx context.Context, userUUID string, publicOnly bool) (ReviewSummary, error) {
	query := `SELECT COALESCE(AVG(rating)::numeric,0), COUNT(*) FROM profile_reviews WHERE user_uuid=$1`
	args := []any{userUUID}
	if publicOnly {
		query += ` AND is_public = TRUE`
	}
	var avg sql.NullFloat64
	var count int
	if err := s.db.QueryRowxContext(ctx, query, args...).Scan(&avg, &count); err != nil {
		return ReviewSummary{}, err
	}
	result := ReviewSummary{Average: 0, Count: count}
	if avg.Valid {
		result.Average = avg.Float64
	}
	return result, nil
}

func (s *Store) SetVerificationStatus(ctx context.Context, targetUUID, reviewerUUID, status string, notes *string) (Profile, error) {
	status = strings.ToLower(strings.TrimSpace(status))
	if !isValidVerificationStatus(status) {
		return Profile{}, errors.New("profile: invalid verification status")
	}
	now := time.Now().UTC()
	query := `
		UPDATE profiles
		SET verification_status=$1,
		    verification_notes=$2,
		    verified_by=$3,
		    verified_at=CASE WHEN $1 = 'approved' THEN $4 ELSE NULL END,
		    updated_at=$4
		WHERE user_uuid=$5
		RETURNING user_uuid, profile_type, display_name, headline, company_name, phone, website,
		          location, bio, specialties, avatar_url, is_public, completion_score,
		          completion_sections, verification_status, verification_notes, verified_by, verified_at,
		          created_at, updated_at
	`
	var row profileRow
	if err := s.db.QueryRowxContext(ctx, query, status, nullable(notes), reviewerUUID, now, targetUUID).Scan(
		&row.UserUUID, &row.ProfileType, &row.DisplayName, &row.Headline, &row.CompanyName, &row.Phone, &row.Website,
		&row.Location, &row.Bio, &row.Specialties, &row.AvatarURL, &row.IsPublic, &row.CompletionScore,
		&row.CompletionSections, &row.VerificationStatus, &row.VerificationNotes, &row.VerifiedBy, &row.VerifiedAt,
		&row.CreatedAt, &row.UpdatedAt,
	); err != nil {
		return Profile{}, err
	}
	prof, err := row.toProfile()
	if err != nil {
		return Profile{}, err
	}
	if err := s.populateProfile(ctx, &prof, false); err != nil {
		return Profile{}, err
	}
	return prof, nil
}

func isValidVerificationStatus(status string) bool {
	switch status {
	case "pending", "approved", "rejected":
		return true
	default:
		return false
	}
}

func isValidCertificationStatus(status string) bool {
	switch status {
	case "pending", "approved", "rejected":
		return true
	default:
		return false
	}
}

func nullableTime(t *time.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return *t
}

func nullableTimePtr(v sql.NullTime) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time
	return &t
}
