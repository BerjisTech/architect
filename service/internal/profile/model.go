package profile

import (
	"time"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/users"
)

type Profile struct {
	UserUUID           string            `json:"userUuid"`
	ProfileType        users.ProfileType `json:"profileType"`
	DisplayName        *string           `json:"displayName,omitempty"`
	Headline           *string           `json:"headline,omitempty"`
	CompanyName        *string           `json:"companyName,omitempty"`
	Phone              *string           `json:"phone,omitempty"`
	Website            *string           `json:"website,omitempty"`
	Location           *string           `json:"location,omitempty"`
	Bio                *string           `json:"bio,omitempty"`
	Specialties        []string          `json:"specialties"`
	AvatarURL          *string           `json:"avatarUrl,omitempty"`
	IsPublic           bool              `json:"isPublic"`
	CompletionScore    int               `json:"completionScore"`
	CompletionSections map[string]bool   `json:"completionSections"`
	VerificationStatus string            `json:"verificationStatus"`
	VerificationNotes  *string           `json:"verificationNotes,omitempty"`
	VerifiedBy         *string           `json:"verifiedBy,omitempty"`
	VerifiedAt         *time.Time        `json:"verifiedAt,omitempty"`
	CreatedAt          time.Time         `json:"createdAt"`
	UpdatedAt          time.Time         `json:"updatedAt"`
}

type UpdateParams struct {
	ProfileType *users.ProfileType
	DisplayName *string
	Headline    *string
	CompanyName *string
	Phone       *string
	Website     *string
	Location    *string
	Bio         *string
	Specialties *[]string
	AvatarURL   *string
	IsPublic    *bool
}

type DeleteParams struct {
	Hard bool
}
