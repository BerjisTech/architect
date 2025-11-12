package coreapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultTimeout defines the default HTTP timeout for Core API calls.
const DefaultTimeout = 10 * time.Second

// Client wraps HTTP interactions with api.berjis.tech.
type Client struct {
	baseURL     string
	httpClient  *http.Client
	auth        AuthProvider
	userAgent   string
	extraHeader http.Header
}

// Option configures the client.
type Option func(*Client)

// AuthProvider applies authentication to outbound requests.
type AuthProvider interface {
	Apply(ctx context.Context, req *http.Request) error
}

// StaticBearerToken applies a constant bearer token.
type StaticBearerToken string

// Apply sets the Authorization header.
func (t StaticBearerToken) Apply(_ context.Context, req *http.Request) error {
	token := strings.TrimSpace(string(t))
	if token == "" {
		return errors.New("coreapi: empty bearer token")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

// WithHTTPClient overrides the default HTTP client.
func WithHTTPClient(client *http.Client) Option {
	return func(c *Client) {
		c.httpClient = client
	}
}

// WithAuthProvider sets the authentication provider.
func WithAuthProvider(p AuthProvider) Option {
	return func(c *Client) {
		c.auth = p
	}
}

// WithUserAgent overrides the default user agent header.
func WithUserAgent(ua string) Option {
	return func(c *Client) {
		c.userAgent = strings.TrimSpace(ua)
	}
}

// WithExtraHeader adds static headers to every request (e.g., API keys).
func WithExtraHeader(header http.Header) Option {
	return func(c *Client) {
		for k, values := range header {
			for _, v := range values {
				c.extraHeader.Add(k, v)
			}
		}
	}
}

// New constructs a Core API client.
func New(baseURL string, opts ...Option) (*Client, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return nil, errors.New("coreapi: base URL required")
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("coreapi: invalid base url: %w", err)
	}
	if u.Scheme == "" {
		return nil, errors.New("coreapi: base URL must include scheme (https://)")
	}
	c := &Client{
		baseURL:    strings.TrimRight(u.String(), "/"),
		httpClient: &http.Client{Timeout: DefaultTimeout},
		userAgent:  "architect-service/1.0 (+https://berjis.tech)",
		extraHeader: http.Header{
			"Accept": []string{"application/json"},
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	if c.httpClient == nil {
		c.httpClient = &http.Client{Timeout: DefaultTimeout}
	}
	return c, nil
}

// APIError represents an error response from the Core API.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("coreapi: %s (status %d)", e.Message, e.StatusCode)
	}
	return fmt.Sprintf("coreapi: status %d", e.StatusCode)
}

func (c *Client) request(ctx context.Context, method, path string, body any) (*http.Response, error) {
	if ctx == nil {
		return nil, errors.New("coreapi: context required")
	}
	fullURL := c.baseURL + path
	var reader io.Reader
	if body != nil {
		buf := &bytes.Buffer{}
		if err := json.NewEncoder(buf).Encode(body); err != nil {
			return nil, fmt.Errorf("coreapi: encode request: %w", err)
		}
		reader = buf
	}
	req, err := http.NewRequestWithContext(ctx, method, fullURL, reader)
	if err != nil {
		return nil, fmt.Errorf("coreapi: build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, values := range c.extraHeader {
		for _, v := range values {
			req.Header.Add(k, v)
		}
	}
	if c.userAgent != "" {
		req.Header.Set("User-Agent", c.userAgent)
	}
	if c.auth != nil {
		if err := c.auth.Apply(ctx, req); err != nil {
			return nil, err
		}
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("coreapi: send request: %w", err)
	}
	if resp.StatusCode >= 400 {
		err := parseError(resp)
		return nil, err
	}
	return resp, nil
}

func parseError(resp *http.Response) error {
	defer resp.Body.Close()
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	msg := ""
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<15))
	if err == nil && len(b) > 0 {
		if json.Unmarshal(b, &payload) == nil {
			if payload.Message != "" {
				msg = payload.Message
			} else if payload.Error != "" {
				msg = payload.Error
			}
		}
		if msg == "" {
			msg = strings.TrimSpace(string(b))
		}
	}
	if msg == "" {
		msg = resp.Status
	}
	return &APIError{StatusCode: resp.StatusCode, Message: msg}
}

func decodeEnvelope[T any](resp *http.Response) (T, error) {
	defer resp.Body.Close()
	var env Envelope[T]
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		var zero T
		return zero, fmt.Errorf("coreapi: decode response: %w", err)
	}
	if !env.Success {
		var zero T
		return zero, &APIError{StatusCode: resp.StatusCode, Message: env.Message}
	}
	return env.Data, nil
}

func decodeJSON[T any](resp *http.Response) (T, error) {
	defer resp.Body.Close()
	var out T
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		var zero T
		return zero, fmt.Errorf("coreapi: decode response: %w", err)
	}
	return out, nil
}

// Support Tickets ----------------------------------------------------------------

// ListSupportTickets returns the current user's tickets.
func (c *Client) ListSupportTickets(ctx context.Context) ([]SupportTicket, error) {
	resp, err := c.request(ctx, http.MethodGet, "/v1/support/tickets", nil)
	if err != nil {
		return nil, err
	}
	return decodeEnvelope[[]SupportTicket](resp)
}

// CreateSupportTicket opens a new support ticket.
func (c *Client) CreateSupportTicket(ctx context.Context, req SupportTicketRequest) error {
	resp, err := c.request(ctx, http.MethodPost, "/v1/support/tickets", req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var env Envelope[struct{}]
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return fmt.Errorf("coreapi: decode response: %w", err)
	}
	if !env.Success {
		return &APIError{StatusCode: resp.StatusCode, Message: env.Message}
	}
	return nil
}

// Billing ------------------------------------------------------------------------

// CreatePaymentIntent creates a payment intent.
func (c *Client) CreatePaymentIntent(ctx context.Context, req PaymentIntentRequest) (PaymentIntent, error) {
	resp, err := c.request(ctx, http.MethodPost, "/v1/billing/payment-intents", req)
	if err != nil {
		return PaymentIntent{}, err
	}
	return decodeEnvelope[PaymentIntent](resp)
}

// GetPaymentIntent fetches a payment intent by ID.
func (c *Client) GetPaymentIntent(ctx context.Context, id int64) (PaymentIntent, error) {
	path := fmt.Sprintf("/v1/billing/payment-intents/%d", id)
	resp, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return PaymentIntent{}, err
	}
	return decodeEnvelope[PaymentIntent](resp)
}

// ListSubscriptions returns the active subscriptions for the current user.
func (c *Client) ListSubscriptions(ctx context.Context) ([]Subscription, error) {
	resp, err := c.request(ctx, http.MethodGet, "/v1/billing/subscriptions", nil)
	if err != nil {
		return nil, err
	}
	return decodeEnvelope[[]Subscription](resp)
}

// CreateSubscription provisions a subscription record for the user.
func (c *Client) CreateSubscription(ctx context.Context, req CreateSubscriptionRequest) (Subscription, error) {
	resp, err := c.request(ctx, http.MethodPost, "/v1/billing/subscriptions", req)
	if err != nil {
		return Subscription{}, err
	}
	return decodeEnvelope[Subscription](resp)
}

// CancelSubscription cancels a subscription by ID.
func (c *Client) CancelSubscription(ctx context.Context, id int64) error {
	path := fmt.Sprintf("/v1/billing/subscriptions/%d/cancel", id)
	resp, err := c.request(ctx, http.MethodPatch, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var env Envelope[struct{}]
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return fmt.Errorf("coreapi: decode response: %w", err)
	}
	if !env.Success {
		return &APIError{StatusCode: resp.StatusCode, Message: env.Message}
	}
	return nil
}

// Users -------------------------------------------------------------------------

// GetMe returns the authenticated user's profile.
func (c *Client) GetMe(ctx context.Context) (MeProfile, error) {
	resp, err := c.request(ctx, http.MethodGet, "/v1/me", nil)
	if err != nil {
		return MeProfile{}, err
	}
	return decodeEnvelope[MeProfile](resp)
}

// UpdateMe updates basic profile fields.
func (c *Client) UpdateMe(ctx context.Context, req UpdateMeRequest) error {
	resp, err := c.request(ctx, http.MethodPut, "/v1/me", req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var env Envelope[struct{}]
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return fmt.Errorf("coreapi: decode response: %w", err)
	}
	if !env.Success {
		return &APIError{StatusCode: resp.StatusCode, Message: env.Message}
	}
	return nil
}

// UpdateProfile updates extended profile attributes.
func (c *Client) UpdateProfile(ctx context.Context, req ProfileUpdateRequest) (MeProfile, error) {
	resp, err := c.request(ctx, http.MethodPut, "/v1/me/profile", req)
	if err != nil {
		return MeProfile{}, err
	}
	return decodeEnvelope[MeProfile](resp)
}

// UpdateFilteredWords sets moderation filters for the user.
func (c *Client) UpdateFilteredWords(ctx context.Context, words []string) ([]string, error) {
	req := FilteredWordsRequest{FilteredWords: words}
	resp, err := c.request(ctx, http.MethodPut, "/v1/me/moderation/filters", req)
	if err != nil {
		return nil, err
	}
	out, err := decodeJSON[FilteredWordsResponse](resp)
	if err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, &APIError{StatusCode: resp.StatusCode, Message: "moderation filters update failed"}
	}
	return out.Data.FilteredWords, nil
}

// BlockUser blocks the specified user UUID.
func (c *Client) BlockUser(ctx context.Context, userID string) ([]string, error) {
	req := BlockUserRequest{UserID: userID}
	resp, err := c.request(ctx, http.MethodPost, "/v1/me/blocks", req)
	if err != nil {
		return nil, err
	}
	out, err := decodeJSON[BlockListResponse](resp)
	if err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, &APIError{StatusCode: resp.StatusCode, Message: "block request rejected"}
	}
	return out.Data.BlockedUsers, nil
}

// UnblockUser removes a user from the block list.
func (c *Client) UnblockUser(ctx context.Context, userID string) ([]string, error) {
	path := fmt.Sprintf("/v1/me/blocks/%s", url.PathEscape(userID))
	resp, err := c.request(ctx, http.MethodDelete, path, nil)
	if err != nil {
		return nil, err
	}
	out, err := decodeJSON[BlockListResponse](resp)
	if err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, &APIError{StatusCode: resp.StatusCode, Message: "unblock request rejected"}
	}
	return out.Data.BlockedUsers, nil
}

// ReportUser files a moderation report.
func (c *Client) ReportUser(ctx context.Context, req ReportUserRequest) error {
	resp, err := c.request(ctx, http.MethodPost, "/v1/reports", req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var env Envelope[struct{}]
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return fmt.Errorf("coreapi: decode response: %w", err)
	}
	if !env.Success {
		return &APIError{StatusCode: resp.StatusCode, Message: env.Message}
	}
	return nil
}

// SearchUsers performs directory search.
func (c *Client) SearchUsers(ctx context.Context, query string, limit int) ([]UserSearchResult, error) {
	if strings.TrimSpace(query) == "" {
		return nil, errors.New("coreapi: query required")
	}
	if limit <= 0 {
		limit = 20
	}
	params := url.Values{}
	params.Set("q", query)
	params.Set("limit", fmt.Sprintf("%d", limit))
	path := "/v1/users/search?" + params.Encode()
	resp, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	return decodeEnvelope[[]UserSearchResult](resp)
}
