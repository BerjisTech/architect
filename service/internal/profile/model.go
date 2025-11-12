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
	Portfolio          []PortfolioItem   `json:"portfolio"`
	Certifications     []Certification   `json:"certifications"`
	ReviewSummary      ReviewSummary     `json:"reviewSummary"`
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

type PortfolioItem struct {
	ID          string    `json:"id"`
	UserUUID    string    `json:"userUuid"`
	Title       string    `json:"title"`
	Description *string   `json:"description,omitempty"`
	MediaURL    *string   `json:"mediaUrl,omitempty"`
	Tags        []string  `json:"tags"`
	IsPublic    bool      `json:"isPublic"`
	Position    int       `json:"position"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type PortfolioInput struct {
	ID          *string  `json:"id,omitempty"`
	Title       string   `json:"title"`
	Description *string  `json:"description,omitempty"`
	MediaURL    *string  `json:"mediaUrl,omitempty"`
	Tags        []string `json:"tags"`
	IsPublic    *bool    `json:"isPublic,omitempty"`
	Position    *int     `json:"position,omitempty"`
}

type Certification struct {
	ID            string     `json:"id"`
	UserUUID      string     `json:"userUuid"`
	Name          string     `json:"name"`
	Issuer        *string    `json:"issuer,omitempty"`
	IssuedOn      *time.Time `json:"issuedOn,omitempty"`
	ExpiresOn     *time.Time `json:"expiresOn,omitempty"`
	CredentialID  *string    `json:"credentialId,omitempty"`
	CredentialURL *string    `json:"credentialUrl,omitempty"`
	Status        string     `json:"status"`
	ReviewedBy    *string    `json:"reviewedBy,omitempty"`
	ReviewedAt    *time.Time `json:"reviewedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type CertificationInput struct {
	ID            *string    `json:"id,omitempty"`
	Name          string     `json:"name"`
	Issuer        *string    `json:"issuer,omitempty"`
	IssuedOn      *time.Time `json:"issuedOn,omitempty"`
	ExpiresOn     *time.Time `json:"expiresOn,omitempty"`
	CredentialID  *string    `json:"credentialId,omitempty"`
	CredentialURL *string    `json:"credentialUrl,omitempty"`
}

type Review struct {
	ID           string    `json:"id"`
	UserUUID     string    `json:"userUuid"`
	ReviewerUUID string    `json:"reviewerUuid"`
	Rating       int       `json:"rating"`
	Title        *string   `json:"title,omitempty"`
	Comment      *string   `json:"comment,omitempty"`
	IsPublic     bool      `json:"isPublic"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ReviewInput struct {
	Rating   int     `json:"rating"`
	Title    *string `json:"title,omitempty"`
	Comment  *string `json:"comment,omitempty"`
	IsPublic *bool   `json:"isPublic,omitempty"`
}

type ReviewSummary struct {
	Average float64 `json:"average"`
	Count   int     `json:"count"`
}
