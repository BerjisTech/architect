package coreapi

import "time"

// Envelope matches the generic API response wrapper.
type Envelope[T any] struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Data    T      `json:"data"`
}

// SupportTicket represents a helpdesk ticket.
type SupportTicket struct {
	ID        int64     `json:"id"`
	Subject   string    `json:"subject"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// SupportTicketRequest is the payload for creating a ticket.
type SupportTicketRequest struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// PaymentIntent describes a billing intent.
type PaymentIntent struct {
	ID          int64   `json:"id"`
	UserUUID    string  `json:"user_uuid"`
	Provider    string  `json:"provider"`
	AmountCents int64   `json:"amount_cents"`
	Currency    string  `json:"currency"`
	Description *string `json:"description,omitempty"`
	Status      string  `json:"status"`
}

// PaymentIntentRequest models the request body to create an intent.
type PaymentIntentRequest struct {
	AmountCents int64  `json:"amount_cents"`
	Currency    string `json:"currency,omitempty"`
	Description string `json:"description,omitempty"`
	Provider    string `json:"provider,omitempty"`
}

// Subscription represents a subscription record.
type Subscription struct {
	ID               int64      `json:"id"`
	UserUUID         string     `json:"user_uuid"`
	ProductKey       string     `json:"product_key"`
	Status           string     `json:"status"`
	CurrentPeriodEnd *time.Time `json:"current_period_end,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// CreateSubscriptionRequest is used to create subscriptions.
type CreateSubscriptionRequest struct {
	ProductKey       string     `json:"product_key"`
	Status           string     `json:"status,omitempty"`
	CurrentPeriodEnd *time.Time `json:"current_period_end,omitempty"`
}

// MeProfile mirrors the Core API profile schema.
type MeProfile struct {
	UUID          string         `json:"uuid"`
	Email         string         `json:"email"`
	Name          *string        `json:"name,omitempty"`
	Username      *string        `json:"username,omitempty"`
	AvatarURL     *string        `json:"avatarUrl,omitempty"`
	PublicProfile bool           `json:"publicProfile"`
	FilteredWords []string       `json:"filteredWords,omitempty"`
	BlockedUsers  []string       `json:"blockedUsers,omitempty"`
	Preferences   map[string]any `json:"preferences,omitempty"`
}

// UpdateMeRequest updates the basic profile fields.
type UpdateMeRequest struct {
	Name     *string `json:"name,omitempty"`
	Password *string `json:"password,omitempty"`
}

// ProfileUpdateRequest updates extended profile data.
type ProfileUpdateRequest struct {
	Name          *string `json:"name,omitempty"`
	Username      *string `json:"username,omitempty"`
	AvatarURL     *string `json:"avatarUrl,omitempty"`
	PublicProfile *bool   `json:"publicProfile,omitempty"`
}

// FilteredWordsRequest updates moderation filters.
type FilteredWordsRequest struct {
	FilteredWords []string `json:"filteredWords"`
}

// FilteredWordsResponse is returned after updating filters.
type FilteredWordsResponse struct {
	Success bool `json:"success"`
	Data    struct {
		FilteredWords []string `json:"filteredWords"`
	} `json:"data"`
}

// BlockUserRequest sends a block command.
type BlockUserRequest struct {
	UserID string `json:"userId"`
}

// BlockListResponse represents the updated block list.
type BlockListResponse struct {
	Success bool `json:"success"`
	Data    struct {
		BlockedUsers []string `json:"blockedUsers"`
	} `json:"data"`
}

// ReportUserRequest submits a moderation report.
type ReportUserRequest struct {
	UserID string `json:"userId"`
	Reason string `json:"reason"`
	Notes  string `json:"notes,omitempty"`
}

// UserSearchResult is returned by the directory search.
type UserSearchResult struct {
	ID       string  `json:"id"`
	Username *string `json:"username,omitempty"`
	Name     *string `json:"name,omitempty"`
}

// AppRoleRequest represents a request to add or remove an app-scoped role.
type AppRoleRequest struct {
	Role     string `json:"role"`
	UserUUID string `json:"userUuid,omitempty"`
}
