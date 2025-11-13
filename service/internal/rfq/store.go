package rfq

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

var (
	ErrRequestNotFound  = errors.New("rfq: request not found")
	ErrQuoteNotFound    = errors.New("rfq: quote not found")
	ErrNotAuthorised    = errors.New("rfq: not authorised")
	ErrInvalidOperation = errors.New("rfq: invalid operation")
)

type Store struct {
	db *sqlx.DB
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

type Request struct {
	ID               string          `json:"id"`
	RequesterUUID    string          `json:"requesterUuid"`
	Title            string          `json:"title"`
	Description      *string         `json:"description,omitempty"`
	Category         string          `json:"category"`
	Status           string          `json:"status"`
	BudgetCents      int64           `json:"budgetCents"`
	Currency         string          `json:"currency"`
	DesiredStartDate *time.Time      `json:"desiredStartDate,omitempty"`
	DeadlineAt       *time.Time      `json:"deadlineAt,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
	UpdatedAt        time.Time       `json:"updatedAt"`
	Invitations      []RequestInvite `json:"invitations"`
	Quotes           []Quote         `json:"quotes"`
	Messages         []Message       `json:"messages"`
}

type RequestInvite struct {
	ID               string     `json:"id"`
	RequestID        string     `json:"requestId"`
	ProviderUUID     string     `json:"providerUuid"`
	ListingID        *string    `json:"listingId,omitempty"`
	InvitationStatus string     `json:"invitationStatus"`
	InvitedAt        time.Time  `json:"invitedAt"`
	RespondedAt      *time.Time `json:"respondedAt,omitempty"`
}

type Quote struct {
	ID           string     `json:"id"`
	RequestID    string     `json:"requestId"`
	ProviderUUID string     `json:"providerUuid"`
	ListingID    *string    `json:"listingId,omitempty"`
	Version      int        `json:"version"`
	AmountCents  int64      `json:"amountCents"`
	Currency     string     `json:"currency"`
	Summary      *string    `json:"summary,omitempty"`
	Status       string     `json:"status"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	SubmittedAt  *time.Time `json:"submittedAt,omitempty"`
	AcceptedAt   *time.Time `json:"acceptedAt,omitempty"`
	RejectedAt   *time.Time `json:"rejectedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type Message struct {
	ID         string    `json:"id"`
	RequestID  string    `json:"requestId"`
	QuoteID    *string   `json:"quoteId,omitempty"`
	AuthorUUID string    `json:"authorUuid"`
	AuthorRole string    `json:"authorRole"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"createdAt"`
}

type ProviderInvite struct {
	ProviderUUID string
	ListingID    *string
}

type RequestInput struct {
	RequesterUUID    string
	Title            string
	Description      *string
	Category         string
	BudgetCents      int64
	Currency         string
	DesiredStartDate *time.Time
	DeadlineAt       *time.Time
	Invites          []ProviderInvite
}

type QuoteInput struct {
	AmountCents int64
	Currency    string
	Summary     *string
	ExpiresAt   *time.Time
	Submit      bool
}

type MessageInput struct {
	AuthorUUID string
	AuthorRole string
	Body       string
	QuoteID    *string
}

func (s *Store) CreateRequest(ctx context.Context, input RequestInput) (Request, error) {
	input = sanitizeRequestInput(input)
	if strings.TrimSpace(input.RequesterUUID) == "" {
		return Request{}, errors.New("rfq: requester required")
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return Request{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	now := time.Now().UTC()
	row := tx.QueryRowContext(ctx, `
		INSERT INTO rfq_requests (requester_uuid, title, description, category, status, budget_cents, currency, desired_start_date, deadline_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$9)
		RETURNING id, requester_uuid, title, description, category, status, budget_cents, currency, desired_start_date, deadline_at, created_at, updated_at
	`, input.RequesterUUID, input.Title, nullable(input.Description), input.Category, input.BudgetCents, input.Currency, input.DesiredStartDate, input.DeadlineAt, now)
	req, err := scanRequest(row)
	if err != nil {
		return Request{}, err
	}

	for _, invite := range input.Invites {
		if strings.TrimSpace(invite.ProviderUUID) == "" {
			continue
		}
		var listingID *string
		if invite.ListingID != nil {
			trimmed := strings.TrimSpace(*invite.ListingID)
			if trimmed != "" {
				listingID = &trimmed
			}
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO rfq_request_providers (request_id, provider_uuid, listing_id, invitation_status, invited_at)
			VALUES ($1,$2,$3,'pending',$4)
		`, req.ID, invite.ProviderUUID, nullable(listingID), now)
		if err != nil {
			return Request{}, err
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO rfq_quotes (request_id, provider_uuid, listing_id, version, amount_cents, currency, status, created_at, updated_at)
			VALUES ($1,$2,$3,1,0,$4,'draft',$5,$5)
		`, req.ID, invite.ProviderUUID, nullable(listingID), req.Currency, now)
		if err != nil {
			return Request{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Request{}, err
	}
	return s.GetRequestForRequester(ctx, req.ID, req.RequesterUUID)
}

func (s *Store) GetRequestForRequester(ctx context.Context, requestID, requesterUUID string) (Request, error) {
	var req Request
	row := s.db.QueryRowContext(ctx, `
		SELECT id, requester_uuid, title, description, category, status, budget_cents, currency, desired_start_date, deadline_at, created_at, updated_at
		FROM rfq_requests
		WHERE id=$1 AND requester_uuid=$2
	`, requestID, requesterUUID)
	var err error
	req, err = scanRequest(row)
	if err != nil {
		if errors.Is(err, ErrRequestNotFound) {
			return Request{}, ErrRequestNotFound
		}
		return Request{}, err
	}
	return s.populateRequest(ctx, req)
}

func (s *Store) GetRequestForProvider(ctx context.Context, requestID, providerUUID string) (Request, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT r.id, r.requester_uuid, r.title, r.description, r.category, r.status, r.budget_cents, r.currency, r.desired_start_date, r.deadline_at, r.created_at, r.updated_at
		FROM rfq_requests r
		INNER JOIN rfq_request_providers rp ON rp.request_id = r.id
		WHERE r.id=$1 AND rp.provider_uuid=$2
	`, requestID, providerUUID)
	req, err := scanRequest(row)
	if err != nil {
		if errors.Is(err, ErrRequestNotFound) {
			return Request{}, ErrRequestNotFound
		}
		return Request{}, err
	}
	return s.populateRequest(ctx, req)
}

func (s *Store) ListRequestsByRequester(ctx context.Context, requesterUUID string) ([]Request, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT id, requester_uuid, title, description, category, status, budget_cents, currency, desired_start_date, deadline_at, created_at, updated_at
		FROM rfq_requests
		WHERE requester_uuid=$1
		ORDER BY created_at DESC
	`, requesterUUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Request
	for rows.Next() {
		req, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		populated, err := s.populateRequest(ctx, req)
		if err != nil {
			return nil, err
		}
		result = append(result, populated)
	}
	return result, nil
}

func (s *Store) ListRequestsForProvider(ctx context.Context, providerUUID string) ([]Request, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT r.id, r.requester_uuid, r.title, r.description, r.category, r.status, r.budget_cents, r.currency, r.desired_start_date, r.deadline_at, r.created_at, r.updated_at
		FROM rfq_requests r
		INNER JOIN rfq_request_providers rp ON rp.request_id = r.id
		WHERE rp.provider_uuid=$1
		ORDER BY r.created_at DESC
	`, providerUUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Request
	for rows.Next() {
		req, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		populated, err := s.populateRequest(ctx, req)
		if err != nil {
			return nil, err
		}
		result = append(result, populated)
	}
	return result, nil
}

func (s *Store) SubmitQuote(ctx context.Context, providerUUID, quoteID string, input QuoteInput) (Quote, error) {
	input = sanitizeQuoteInput(input)
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return Quote{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var (
		requestID string
		status    string
		version   int
	)
	err = tx.QueryRowContext(ctx, `
		SELECT request_id, status, version
		FROM rfq_quotes
		WHERE id=$1 AND provider_uuid=$2
		FOR UPDATE
	`, quoteID, providerUUID).Scan(&requestID, &status, &version)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Quote{}, ErrQuoteNotFound
		}
		return Quote{}, err
	}

	now := time.Now().UTC()
	nextVersion := version + 1
	_, err = tx.ExecContext(ctx, `
		INSERT INTO rfq_quote_revisions (quote_id, version, amount_cents, currency, summary, notes, created_at)
		VALUES ($1,$2,$3,$4,$5,NULL,$6)
		ON CONFLICT (quote_id, version) DO NOTHING
	`, quoteID, nextVersion, input.AmountCents, input.Currency, nullable(input.Summary), now)
	if err != nil {
		return Quote{}, err
	}
	newStatus := status
	if input.Submit {
		newStatus = "submitted"
	} else if status == "draft" {
		newStatus = "draft"
	}
	var submittedAt any
	if input.Submit {
		submittedAt = now
	} else {
		submittedAt = nil
	}
	var expires any
	if input.ExpiresAt != nil {
		expires = *input.ExpiresAt
	} else {
		expires = nil
	}

	row := tx.QueryRowContext(ctx, `
		UPDATE rfq_quotes
		SET amount_cents=$1,
		    currency=$2,
		    summary=$3,
		    status=$4,
		    expires_at=$5,
		    submitted_at=CASE WHEN $6::timestamptz IS NULL THEN submitted_at ELSE $6 END,
		    version=$7,
		    updated_at=$8
		WHERE id=$9
		RETURNING id, request_id, provider_uuid, listing_id, version, amount_cents, currency, summary, status, expires_at, submitted_at, accepted_at, rejected_at, created_at, updated_at
	`, input.AmountCents, input.Currency, nullable(input.Summary), newStatus, expires, submittedAt, nextVersion, now, quoteID)
	quote, err := scanQuote(row)
	if err != nil {
		return Quote{}, err
	}
	if err = tx.Commit(); err != nil {
		return Quote{}, err
	}
	_ = s.markExpiredQuotes(ctx, []string{requestID})
	return quote, nil
}

func (s *Store) AcceptQuote(ctx context.Context, requesterUUID, quoteID string) (Request, error) {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return Request{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var (
		requestID string
	)
	err = tx.QueryRowContext(ctx, `
		SELECT q.request_id
		FROM rfq_quotes q
		INNER JOIN rfq_requests r ON r.id = q.request_id
		WHERE q.id=$1 AND r.requester_uuid=$2
		FOR UPDATE
	`, quoteID, requesterUUID).Scan(&requestID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Request{}, ErrQuoteNotFound
		}
		return Request{}, err
	}
	now := time.Now().UTC()
	if _, err = tx.ExecContext(ctx, `
		UPDATE rfq_quotes
		SET status=CASE WHEN id=$1 THEN 'accepted' ELSE 'rejected' END,
		    accepted_at=CASE WHEN id=$1 THEN $2 ELSE accepted_at END,
		    rejected_at=CASE WHEN id=$1 THEN NULL ELSE $2 END,
		    updated_at=$2
		WHERE request_id=$3
	`, quoteID, now, requestID); err != nil {
		return Request{}, err
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE rfq_requests
		SET status='accepted', updated_at=$2
		WHERE id=$1
	`, requestID, now); err != nil {
		return Request{}, err
	}
	if err = tx.Commit(); err != nil {
		return Request{}, err
	}
	return s.GetRequestForRequester(ctx, requestID, requesterUUID)
}

func (s *Store) RejectQuote(ctx context.Context, requesterUUID, quoteID string) (Request, error) {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return Request{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var requestID string
	err = tx.QueryRowContext(ctx, `
		SELECT q.request_id
		FROM rfq_quotes q
		INNER JOIN rfq_requests r ON r.id = q.request_id
		WHERE q.id=$1 AND r.requester_uuid=$2
		FOR UPDATE
	`, quoteID, requesterUUID).Scan(&requestID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Request{}, ErrQuoteNotFound
		}
		return Request{}, err
	}
	now := time.Now().UTC()
	if _, err = tx.ExecContext(ctx, `
		UPDATE rfq_quotes
		SET status='rejected', rejected_at=$2, updated_at=$2
		WHERE id=$1
	`, quoteID, now); err != nil {
		return Request{}, err
	}
	// If no accepted quotes remain, keep request open
	if _, err = tx.ExecContext(ctx, `
		UPDATE rfq_requests
		SET status = CASE
			WHEN EXISTS (SELECT 1 FROM rfq_quotes WHERE request_id=$1 AND status='accepted') THEN status
			ELSE 'open'
		END,
		updated_at=$2
		WHERE id=$1
	`, requestID, now); err != nil {
		return Request{}, err
	}
	if err = tx.Commit(); err != nil {
		return Request{}, err
	}
	return s.GetRequestForRequester(ctx, requestID, requesterUUID)
}

func (s *Store) AddMessage(ctx context.Context, requestID string, input MessageInput) (Message, error) {
	body := strings.TrimSpace(input.Body)
	if body == "" {
		return Message{}, errors.New("rfq: message body required")
	}
	now := time.Now().UTC()
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO rfq_messages (request_id, quote_id, author_uuid, author_role, body, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, request_id, quote_id, author_uuid, author_role, body, created_at
	`, requestID, nullable(input.QuoteID), input.AuthorUUID, strings.TrimSpace(strings.ToLower(input.AuthorRole)), body, now)
	msg, err := scanMessage(row)
	if err != nil {
		return Message{}, err
	}
	return msg, nil
}

func (s *Store) markExpiredQuotes(ctx context.Context, requestIDs []string) error {
	if len(requestIDs) == 0 {
		return nil
	}
	query, args, err := sqlx.In(`
		UPDATE rfq_quotes
		SET status='expired', updated_at=now()
		WHERE request_id IN (?) AND status IN ('submitted') AND expires_at IS NOT NULL AND expires_at < now()
	`, requestIDs)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, s.db.Rebind(query), args...)
	return err
}

func (s *Store) populateRequest(ctx context.Context, req Request) (Request, error) {
	if err := s.markExpiredQuotes(ctx, []string{req.ID}); err != nil {
		return Request{}, err
	}
	req.Invitations = []RequestInvite{}
	inviteRows, err := s.db.QueryxContext(ctx, `
		SELECT id, request_id, provider_uuid, listing_id, invitation_status, invited_at, responded_at
		FROM rfq_request_providers
		WHERE request_id=$1
		ORDER BY invited_at
	`, req.ID)
	if err != nil {
		return Request{}, err
	}
	defer inviteRows.Close()
	for inviteRows.Next() {
		var (
			id           string
			requestID    string
			providerUUID string
			listingID    sql.NullString
			status       string
			invitedAt    time.Time
			respondedAt  sql.NullTime
		)
		if err := inviteRows.Scan(&id, &requestID, &providerUUID, &listingID, &status, &invitedAt, &respondedAt); err != nil {
			return Request{}, err
		}
		req.Invitations = append(req.Invitations, RequestInvite{
			ID:               id,
			RequestID:        requestID,
			ProviderUUID:     providerUUID,
			ListingID:        nullableStringPtr(listingID),
			InvitationStatus: status,
			InvitedAt:        invitedAt,
			RespondedAt:      nullableTimePtr(respondedAt),
		})
	}
	quoteRows, err := s.db.QueryxContext(ctx, `
		SELECT id, request_id, provider_uuid, listing_id, version, amount_cents, currency, summary, status, expires_at, submitted_at, accepted_at, rejected_at, created_at, updated_at
		FROM rfq_quotes
		WHERE request_id=$1
		ORDER BY created_at
	`, req.ID)
	if err != nil {
		return Request{}, err
	}
	defer quoteRows.Close()
	req.Quotes = []Quote{}
	for quoteRows.Next() {
		quote, err := scanQuote(quoteRows)
		if err != nil {
			return Request{}, err
		}
		req.Quotes = append(req.Quotes, quote)
	}
	messageRows, err := s.db.QueryxContext(ctx, `
		SELECT id, request_id, quote_id, author_uuid, author_role, body, created_at
		FROM rfq_messages
		WHERE request_id=$1
		ORDER BY created_at ASC
	`, req.ID)
	if err != nil {
		return Request{}, err
	}
	defer messageRows.Close()
	req.Messages = []Message{}
	for messageRows.Next() {
		msg, err := scanMessage(messageRows)
		if err != nil {
			return Request{}, err
		}
		req.Messages = append(req.Messages, msg)
	}
	return req, nil
}

func sanitizeRequestInput(in RequestInput) RequestInput {
	in.Title = strings.TrimSpace(in.Title)
	in.Category = strings.TrimSpace(strings.ToLower(in.Category))
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if in.Currency == "" {
		in.Currency = "USD"
	}
	if in.BudgetCents < 0 {
		in.BudgetCents = 0
	}
	if in.Description != nil {
		trimmed := strings.TrimSpace(*in.Description)
		if trimmed == "" {
			in.Description = nil
		} else {
			copy := trimmed
			in.Description = &copy
		}
	}
	return in
}

func sanitizeQuoteInput(in QuoteInput) QuoteInput {
	if in.AmountCents < 0 {
		in.AmountCents = 0
	}
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if in.Currency == "" {
		in.Currency = "USD"
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
	return in
}

func scanRequest(row interface {
	Scan(dest ...any) error
}) (Request, error) {
	var (
		id            string
		requesterUUID string
		title         string
		description   sql.NullString
		category      string
		status        string
		budgetCents   int64
		currency      string
		startDate     sql.NullTime
		deadline      sql.NullTime
		createdAt     time.Time
		updatedAt     time.Time
	)
	if err := row.Scan(&id, &requesterUUID, &title, &description, &category, &status, &budgetCents, &currency, &startDate, &deadline, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Request{}, ErrRequestNotFound
		}
		return Request{}, err
	}
	return Request{
		ID:               id,
		RequesterUUID:    requesterUUID,
		Title:            title,
		Description:      nullableStringPtr(description),
		Category:         category,
		Status:           status,
		BudgetCents:      budgetCents,
		Currency:         currency,
		DesiredStartDate: nullableTimePtr(startDate),
		DeadlineAt:       nullableTimePtr(deadline),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

func scanQuote(row interface {
	Scan(dest ...any) error
}) (Quote, error) {
	var (
		id           string
		requestID    string
		providerUUID string
		listingID    sql.NullString
		version      int
		amountCents  int64
		currency     string
		summary      sql.NullString
		status       string
		expiresAt    sql.NullTime
		submittedAt  sql.NullTime
		acceptedAt   sql.NullTime
		rejectedAt   sql.NullTime
		createdAt    time.Time
		updatedAt    time.Time
	)
	if err := row.Scan(&id, &requestID, &providerUUID, &listingID, &version, &amountCents, &currency, &summary, &status, &expiresAt, &submittedAt, &acceptedAt, &rejectedAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Quote{}, ErrQuoteNotFound
		}
		return Quote{}, err
	}
	return Quote{
		ID:           id,
		RequestID:    requestID,
		ProviderUUID: providerUUID,
		ListingID:    nullableStringPtr(listingID),
		Version:      version,
		AmountCents:  amountCents,
		Currency:     currency,
		Summary:      nullableStringPtr(summary),
		Status:       status,
		ExpiresAt:    nullableTimePtr(expiresAt),
		SubmittedAt:  nullableTimePtr(submittedAt),
		AcceptedAt:   nullableTimePtr(acceptedAt),
		RejectedAt:   nullableTimePtr(rejectedAt),
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}, nil
}

func scanMessage(row interface {
	Scan(dest ...any) error
}) (Message, error) {
	var (
		id         string
		requestID  string
		quoteID    sql.NullString
		authorUUID string
		authorRole string
		body       string
		createdAt  time.Time
	)
	if err := row.Scan(&id, &requestID, &quoteID, &authorUUID, &authorRole, &body, &createdAt); err != nil {
		return Message{}, err
	}
	return Message{
		ID:         id,
		RequestID:  requestID,
		QuoteID:    nullableStringPtr(quoteID),
		AuthorUUID: authorUUID,
		AuthorRole: authorRole,
		Body:       body,
		CreatedAt:  createdAt,
	}, nil
}

func nullable(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
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

func (s *Store) CancelRequest(ctx context.Context, requesterUUID, requestID string) (Request, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE rfq_requests
		SET status='cancelled', updated_at=now()
		WHERE id=$1 AND requester_uuid=$2
	`, requestID, requesterUUID)
	if err != nil {
		return Request{}, err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return Request{}, ErrRequestNotFound
	}
	return s.GetRequestForRequester(ctx, requestID, requesterUUID)
}

func (s *Store) CloseRequest(ctx context.Context, requesterUUID, requestID string) (Request, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE rfq_requests
		SET status='closed', updated_at=now()
		WHERE id=$1 AND requester_uuid=$2
	`, requestID, requesterUUID)
	if err != nil {
		return Request{}, err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return Request{}, ErrRequestNotFound
	}
	return s.GetRequestForRequester(ctx, requestID, requesterUUID)
}

func (s *Store) EnsureQuoteForProvider(ctx context.Context, quoteID, providerUUID string) (Quote, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, request_id, provider_uuid, listing_id, version, amount_cents, currency, summary, status, expires_at, submitted_at, accepted_at, rejected_at, created_at, updated_at
		FROM rfq_quotes
		WHERE id=$1 AND provider_uuid=$2
	`, quoteID, providerUUID)
	return scanQuote(row)
}

func (s *Store) CountActiveInvites(ctx context.Context, providerUUID string) (int, error) {
	var total int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM rfq_request_providers
		WHERE provider_uuid=$1 AND invitation_status IN ('pending','responded')
	`, providerUUID).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (s *Store) UpdateInvitationStatus(ctx context.Context, requestID, providerUUID, status string) error {
	status = strings.TrimSpace(strings.ToLower(status))
	if status == "" {
		return fmt.Errorf("rfq: invalid invitation status")
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE rfq_request_providers
		SET invitation_status=$3, responded_at=CASE WHEN $3='responded' THEN now() ELSE responded_at END
		WHERE request_id=$1 AND provider_uuid=$2
	`, requestID, providerUUID, status)
	return err
}
