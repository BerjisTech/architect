package providers

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/profile"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/users"
)

var (
	ErrAlreadyProvider = errors.New("providers: user already onboarding")
	ErrNotEnrolled     = errors.New("providers: user not enrolled")
	ErrInvalidProfile  = errors.New("providers: profile must be completed before onboarding")
)

type Store struct {
	db      *sqlx.DB
	profile *profile.Store
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db, profile: profile.NewStore(db)}
}

type OnboardingStatus struct {
	UserUUID         string            `json:"userUuid"`
	ProfileType      users.ProfileType `json:"profileType"`
	Stage            string            `json:"stage"`
	SubmittedAt      time.Time         `json:"submittedAt"`
	ReviewedBy       *string           `json:"reviewedBy,omitempty"`
	ReviewedAt       *time.Time        `json:"reviewedAt,omitempty"`
	Notes            *string           `json:"notes,omitempty"`
	ProfileCompleted bool              `json:"profileCompleted"`
	Verification     string            `json:"verificationStatus"`
}

func (s *Store) Submit(ctx context.Context, userUUID string, profileType users.ProfileType) (OnboardingStatus, error) {
	profileType = users.ProfileType(strings.ToLower(string(profileType)))
	if users.ProviderRoleByType[profileType] == "" {
		return OnboardingStatus{}, errors.New("providers: invalid profile type")
	}

	var existingStage sql.NullString
	_ = s.db.QueryRowContext(ctx, `SELECT stage FROM provider_onboarding WHERE user_uuid=$1`, userUUID).Scan(&existingStage)
	if existingStage.Valid && existingStage.String == "approved" {
		status, err := s.fetchStatus(ctx, userUUID)
		if err != nil {
			return OnboardingStatus{}, err
		}
		return status, ErrAlreadyProvider
	}

	// profile must exist and have reasonable completion
	prof, err := s.profile.Get(ctx, userUUID)
	if err != nil {
		return OnboardingStatus{}, ErrInvalidProfile
	}
	if prof.CompletionScore < 60 {
		return OnboardingStatus{}, errors.New("providers: profile completion below threshold")
	}

	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO provider_onboarding (user_uuid, profile_type, stage, submitted_at, updated_at)
		VALUES ($1, $2, 'submitted', $3, $3)
		ON CONFLICT (user_uuid) DO UPDATE SET
			profile_type=EXCLUDED.profile_type,
			stage='submitted',
			submitted_at=EXCLUDED.submitted_at,
			updated_at=EXCLUDED.updated_at,
			notes=NULL,
			reviewed_by=NULL,
			reviewed_at=NULL
	`, userUUID, string(profileType), now)
	if err != nil {
		return OnboardingStatus{}, err
	}

	return s.fetchStatus(ctx, userUUID)
}

func (s *Store) SetStage(ctx context.Context, userUUID string, stage string, reviewerUUID string, notes *string) (OnboardingStatus, error) {
	stage = strings.ToLower(strings.TrimSpace(stage))
	if stage != "submitted" && stage != "in_review" && stage != "approved" && stage != "rejected" {
		return OnboardingStatus{}, errors.New("providers: invalid stage")
	}
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx, `
		UPDATE provider_onboarding
		SET stage=$1, notes=$2, reviewed_by=$3, reviewed_at=$4, updated_at=$4
		WHERE user_uuid=$5
	`, stage, nullable(notes), reviewerUUID, now, userUUID)
	if err != nil {
		return OnboardingStatus{}, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return OnboardingStatus{}, ErrNotEnrolled
	}
	return s.fetchStatus(ctx, userUUID)
}

func (s *Store) fetchStatus(ctx context.Context, userUUID string) (OnboardingStatus, error) {
	var (
		uuid        string
		profileType string
		stage       string
		submittedAt time.Time
		reviewedBy  *string
		reviewedVal *time.Time
		notes       *string
		updatedAt   time.Time
	)
	row := s.db.QueryRowContext(ctx, `
		SELECT user_uuid, profile_type, stage, submitted_at, reviewed_by, reviewed_at, notes, updated_at
		FROM provider_onboarding
		WHERE user_uuid=$1
	`, userUUID)
	if err := row.Scan(&uuid, &profileType, &stage, &submittedAt, &reviewedBy, &reviewedVal, &notes, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return OnboardingStatus{}, ErrNotEnrolled
		}
		return OnboardingStatus{}, err
	}
	prof, err := s.profile.Get(ctx, userUUID)
	if err != nil {
		return OnboardingStatus{}, err
	}
	status := OnboardingStatus{
		UserUUID:         uuid,
		ProfileType:      users.ProfileType(profileType),
		Stage:            stage,
		SubmittedAt:      submittedAt,
		ReviewedBy:       reviewedBy,
		ReviewedAt:       reviewedVal,
		Notes:            notes,
		ProfileCompleted: prof.CompletionScore >= 60,
		Verification:     prof.VerificationStatus,
	}
	return status, nil
}

// Status returns the onboarding status for the given user.
func (s *Store) Status(ctx context.Context, userUUID string) (OnboardingStatus, error) {
	return s.fetchStatus(ctx, userUUID)
}

// ListPending returns onboarding requests that are waiting for review.
func (s *Store) ListPending(ctx context.Context) ([]OnboardingStatus, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT user_uuid
		FROM provider_onboarding
		WHERE stage IN ('submitted', 'in_review')
		ORDER BY submitted_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var statuses []OnboardingStatus
	for rows.Next() {
		var uuid string
		if err := rows.Scan(&uuid); err != nil {
			return nil, err
		}
		status, err := s.fetchStatus(ctx, uuid)
		if err != nil {
			if errors.Is(err, ErrNotEnrolled) {
				continue
			}
			return nil, err
		}
		statuses = append(statuses, status)
	}
	return statuses, nil
}

func nullable(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}
