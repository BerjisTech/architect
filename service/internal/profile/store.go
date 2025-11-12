package profile

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/users"
)

var (
	ErrNotFound        = errors.New("profile: not found")
	ErrInvalidType     = errors.New("profile: invalid profile type")
	allowedTypesLookup = buildAllowedTypes()
)

type Store struct {
	db *sqlx.DB
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

type profileRow struct {
	UserUUID           string         `db:"user_uuid"`
	ProfileType        string         `db:"profile_type"`
	DisplayName        sql.NullString `db:"display_name"`
	Headline           sql.NullString `db:"headline"`
	CompanyName        sql.NullString `db:"company_name"`
	Phone              sql.NullString `db:"phone"`
	Website            sql.NullString `db:"website"`
	Location           sql.NullString `db:"location"`
	Bio                sql.NullString `db:"bio"`
	Specialties        pq.StringArray `db:"specialties"`
	AvatarURL          sql.NullString `db:"avatar_url"`
	IsPublic           bool           `db:"is_public"`
	CompletionScore    int            `db:"completion_score"`
	CompletionSections []byte         `db:"completion_sections"`
	VerificationStatus string         `db:"verification_status"`
	VerificationNotes  sql.NullString `db:"verification_notes"`
	VerifiedBy         sql.NullString `db:"verified_by"`
	VerifiedAt         sql.NullTime   `db:"verified_at"`
	CreatedAt          time.Time      `db:"created_at"`
	UpdatedAt          time.Time      `db:"updated_at"`
}

func (r profileRow) toProfile() (Profile, error) {
	var sections map[string]bool
	if len(r.CompletionSections) > 0 {
		if err := json.Unmarshal(r.CompletionSections, &sections); err != nil {
			return Profile{}, err
		}
	}
	if sections == nil {
		sections = map[string]bool{}
	}

	var verifiedAt *time.Time
	if r.VerifiedAt.Valid {
		v := r.VerifiedAt.Time
		verifiedAt = &v
	}

	return Profile{
		UserUUID:           r.UserUUID,
		ProfileType:        users.ProfileType(r.ProfileType),
		DisplayName:        nullableStringPtr(r.DisplayName),
		Headline:           nullableStringPtr(r.Headline),
		CompanyName:        nullableStringPtr(r.CompanyName),
		Phone:              nullableStringPtr(r.Phone),
		Website:            nullableStringPtr(r.Website),
		Location:           nullableStringPtr(r.Location),
		Bio:                nullableStringPtr(r.Bio),
		Specialties:        copyStringSlice([]string(r.Specialties)),
		AvatarURL:          nullableStringPtr(r.AvatarURL),
		IsPublic:           r.IsPublic,
		CompletionScore:    r.CompletionScore,
		CompletionSections: sections,
		VerificationStatus: r.VerificationStatus,
		VerificationNotes:  nullableStringPtr(r.VerificationNotes),
		VerifiedBy:         nullableStringPtr(r.VerifiedBy),
		VerifiedAt:         verifiedAt,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
	}, nil
}

func (s *Store) Get(ctx context.Context, userUUID string) (*Profile, error) {
	var row profileRow
	err := s.db.GetContext(ctx, &row, `
		SELECT user_uuid, profile_type, display_name, headline, company_name, phone, website,
		       location, bio, specialties, avatar_url, is_public, completion_score,
		       completion_sections, verification_status, verification_notes,
		       verified_by, verified_at, created_at, updated_at
		FROM profiles
		WHERE user_uuid = $1
	`, userUUID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	profile, err := row.toProfile()
	if err != nil {
		return nil, err
	}
	if err := s.populateProfile(ctx, &profile, false); err != nil {
		return nil, err
	}
	return &profile, nil
}

func (s *Store) GetPublic(ctx context.Context, userUUID string) (*Profile, error) {
	var row profileRow
	err := s.db.GetContext(ctx, &row, `
		SELECT user_uuid, profile_type, display_name, headline, company_name, phone, website,
		       location, bio, specialties, avatar_url, is_public, completion_score,
		       completion_sections, verification_status, verification_notes,
		       verified_by, verified_at, created_at, updated_at
		FROM profiles
		WHERE user_uuid = $1 AND is_public = TRUE
	`, userUUID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	profile, err := row.toProfile()
	if err != nil {
		return nil, err
	}
	if err := s.populateProfile(ctx, &profile, true); err != nil {
		return nil, err
	}
	return &profile, nil
}

func (s *Store) Upsert(ctx context.Context, userUUID string, params UpdateParams) (*Profile, error) {
	if _, ok := allowedTypesLookup[strings.ToLower(stringValue(params.ProfileType))]; params.ProfileType != nil && !ok {
		return nil, ErrInvalidType
	}

	existing, err := s.Get(ctx, userUUID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if existing == nil {
		existing = &Profile{
			UserUUID:           userUUID,
			ProfileType:        users.ProfileType("homeowner"),
			Specialties:        []string{},
			IsPublic:           true,
			CompletionSections: map[string]bool{},
			VerificationStatus: "pending",
		}
	}

	applyUpdate(existing, params)
	score, sections := calculateCompletion(*existing)
	existing.CompletionScore = score
	existing.CompletionSections = sections

	specialties := pq.StringArray(existing.Specialties)
	sectionsJSON, err := json.Marshal(existing.CompletionSections)
	if err != nil {
		return nil, err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO profiles (
			user_uuid, profile_type, display_name, headline, company_name, phone, website,
			location, bio, specialties, avatar_url, is_public, completion_score,
			completion_sections, verification_status, verification_notes, verified_by, verified_at,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7,
			$8, $9, $10, $11, $12, $13,
			$14, $15, $16, $17, $18,
			now(), now()
		)
		ON CONFLICT (user_uuid) DO UPDATE SET
			profile_type = EXCLUDED.profile_type,
			display_name = EXCLUDED.display_name,
			headline = EXCLUDED.headline,
			company_name = EXCLUDED.company_name,
			phone = EXCLUDED.phone,
			website = EXCLUDED.website,
			location = EXCLUDED.location,
			bio = EXCLUDED.bio,
			specialties = EXCLUDED.specialties,
			avatar_url = EXCLUDED.avatar_url,
			is_public = EXCLUDED.is_public,
			completion_score = EXCLUDED.completion_score,
			completion_sections = EXCLUDED.completion_sections,
			updated_at = now()
	`, existing.UserUUID, string(existing.ProfileType), nullable(existing.DisplayName), nullable(existing.Headline),
		nullable(existing.CompanyName), nullable(existing.Phone), nullable(existing.Website),
		nullable(existing.Location), nullable(existing.Bio), specialties, nullable(existing.AvatarURL),
		existing.IsPublic, existing.CompletionScore, sectionsJSON,
		existing.VerificationStatus, nullable(existing.VerificationNotes), nullable(existing.VerifiedBy), existing.VerifiedAt)
	if err != nil {
		return nil, err
	}

	return s.Get(ctx, userUUID)
}

func (s *Store) Delete(ctx context.Context, userUUID string, params DeleteParams) error {
	if params.Hard {
		_, err := s.db.ExecContext(ctx, `DELETE FROM profiles WHERE user_uuid = $1`, userUUID)
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE profiles
		SET is_public = FALSE, updated_at = now()
		WHERE user_uuid = $1
	`, userUUID)
	return err
}

func applyUpdate(p *Profile, params UpdateParams) {
	if params.ProfileType != nil {
		p.ProfileType = users.ProfileType(strings.ToLower(string(*params.ProfileType)))
		if _, ok := allowedTypesLookup[string(p.ProfileType)]; !ok {
			p.ProfileType = users.ProfileType("homeowner")
		}
	}
	if params.DisplayName != nil {
		p.DisplayName = normalizePtr(params.DisplayName)
	}
	if params.Headline != nil {
		p.Headline = normalizePtr(params.Headline)
	}
	if params.CompanyName != nil {
		p.CompanyName = normalizePtr(params.CompanyName)
	}
	if params.Phone != nil {
		p.Phone = normalizePtr(params.Phone)
	}
	if params.Website != nil {
		p.Website = normalizePtr(params.Website)
	}
	if params.Location != nil {
		p.Location = normalizePtr(params.Location)
	}
	if params.Bio != nil {
		p.Bio = normalizePtr(params.Bio)
	}
	if params.Specialties != nil {
		p.Specialties = normalizeList(*params.Specialties)
	}
	if params.AvatarURL != nil {
		p.AvatarURL = normalizePtr(params.AvatarURL)
	}
	if params.IsPublic != nil {
		p.IsPublic = *params.IsPublic
	}
}

func calculateCompletion(p Profile) (int, map[string]bool) {
	sections := map[string]bool{
		"profileType": strings.TrimSpace(string(p.ProfileType)) != "",
		"displayName": strings.TrimSpace(deref(p.DisplayName)) != "",
		"headline":    strings.TrimSpace(deref(p.Headline)) != "",
		"bio":         strings.TrimSpace(deref(p.Bio)) != "",
		"location":    strings.TrimSpace(deref(p.Location)) != "",
		"contact":     strings.TrimSpace(deref(p.Phone)) != "" || strings.TrimSpace(deref(p.Website)) != "",
		"company":     strings.TrimSpace(deref(p.CompanyName)) != "",
		"portfolio":   len(p.Portfolio) > 0,
		"certifications": len(p.Certifications) > 0,
	}

	completed := 0
	for _, ok := range sections {
		if ok {
			completed++
		}
	}
	total := len(sections)
	if total == 0 {
		return 0, sections
	}
	score := int(float64(completed) / float64(total) * 100)
	if score > 100 {
		score = 100
	}
	return score, sections
}

func buildAllowedTypes() map[string]struct{} {
	allowed := map[string]struct{}{}
	for _, profile := range users.ProviderProfiles {
		allowed[strings.ToLower(string(profile.Type))] = struct{}{}
	}
	return allowed
}

func nullable(v *string) any {
	if v == nil || strings.TrimSpace(*v) == "" {
		return nil
	}
	return strings.TrimSpace(*v)
}

func nullableStringPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := strings.TrimSpace(v.String)
	if s == "" {
		return nil
	}
	return &s
}

func normalizePtr(v *string) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return nil
	}
	return &s
}

func normalizeList(values []string) []string {
	set := make(map[string]string)
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			key := strings.ToLower(trimmed)
			if _, exists := set[key]; !exists {
				set[key] = trimmed
			}
		}
	}
	result := make([]string, 0, len(set))
	for _, original := range set {
		result = append(result, original)
	}
	return result
}

func copyStringSlice(in []string) []string {
	out := make([]string, len(in))
	copy(out, in)
	return out
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func stringValue(v *users.ProfileType) string {
	if v == nil {
		return ""
	}
	return string(*v)
}
