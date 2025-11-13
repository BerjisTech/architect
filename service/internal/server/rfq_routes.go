package server

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/auth"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/rfq"
)

type rfqHandler struct {
	store *rfq.Store
}

func registerRFQRoutes(protected fiber.Router, store *rfq.Store) {
	if store == nil {
		return
	}
	h := rfqHandler{store: store}

	protected.Post("/rfq/requests", h.createRequest)
	protected.Get("/rfq/requests", h.listRequesterRequests)
	protected.Get("/rfq/requests/:id", h.getRequesterRequest)
	protected.Post("/rfq/requests/:id/cancel", h.cancelRequest)
	protected.Post("/rfq/requests/:id/close", h.closeRequest)
	protected.Post("/rfq/requests/:id/messages", h.addMessage)

	protected.Get("/rfq/provider/requests", h.listProviderRequests)
	protected.Get("/rfq/provider/requests/:id", h.getProviderRequest)
	protected.Put("/rfq/provider/quotes/:id", h.updateQuote)
	protected.Post("/rfq/provider/requests/:id/messages", h.addProviderMessage)

	protected.Post("/rfq/quotes/:id/accept", h.acceptQuote)
	protected.Post("/rfq/quotes/:id/reject", h.rejectQuote)
}

func (h rfqHandler) createRequest(c *fiber.Ctx) error {
	user := auth.UserID(c)
	if strings.TrimSpace(user) == "" {
		return forbidden(c)
	}
	var body struct {
		Title            string  `json:"title"`
		Description      *string `json:"description"`
		Category         string  `json:"category"`
		BudgetCents      int64   `json:"budgetCents"`
		Currency         string  `json:"currency"`
		DesiredStartDate *string `json:"desiredStartDate"`
		DeadlineAt       *string `json:"deadlineAt"`
		Invites          []struct {
			ProviderUUID string  `json:"providerUuid"`
			ListingID    *string `json:"listingId"`
		} `json:"invites"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	input := rfq.RequestInput{
		RequesterUUID: user,
		Title:         body.Title,
		Description:   body.Description,
		Category:      body.Category,
		BudgetCents:   body.BudgetCents,
		Currency:      body.Currency,
	}
	if body.DesiredStartDate != nil {
		if t, err := parseISOTime(*body.DesiredStartDate); err == nil {
			input.DesiredStartDate = &t
		}
	}
	if body.DeadlineAt != nil {
		if t, err := parseISOTime(*body.DeadlineAt); err == nil {
			input.DeadlineAt = &t
		}
	}
	for _, invite := range body.Invites {
		inv := rfq.ProviderInvite{
			ProviderUUID: invite.ProviderUUID,
			ListingID:    invite.ListingID,
		}
		input.Invites = append(input.Invites, inv)
	}
	req, err := h.store.CreateRequest(c.Context(), input)
	if err != nil {
		return serverError(c, err)
	}
	return c.Status(http.StatusCreated).JSON(fiber.Map{"success": true, "data": fiber.Map{"request": req}})
}

func (h rfqHandler) listRequesterRequests(c *fiber.Ctx) error {
	user := auth.UserID(c)
	if strings.TrimSpace(user) == "" {
		return forbidden(c)
	}
	requests, err := h.store.ListRequestsByRequester(c.Context(), user)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"requests": requests}})
}

func (h rfqHandler) getRequesterRequest(c *fiber.Ctx) error {
	user := auth.UserID(c)
	if strings.TrimSpace(user) == "" {
		return forbidden(c)
	}
	id := strings.TrimSpace(c.Params("id"))
	req, err := h.store.GetRequestForRequester(c.Context(), id, user)
	if err != nil {
		if errors.Is(err, rfq.ErrRequestNotFound) {
			return notFound(c, "request not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"request": req}})
}

func (h rfqHandler) cancelRequest(c *fiber.Ctx) error {
	user := auth.UserID(c)
	id := strings.TrimSpace(c.Params("id"))
	req, err := h.store.CancelRequest(c.Context(), user, id)
	if err != nil {
		if errors.Is(err, rfq.ErrRequestNotFound) {
			return notFound(c, "request not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"request": req}})
}

func (h rfqHandler) closeRequest(c *fiber.Ctx) error {
	user := auth.UserID(c)
	id := strings.TrimSpace(c.Params("id"))
	req, err := h.store.CloseRequest(c.Context(), user, id)
	if err != nil {
		if errors.Is(err, rfq.ErrRequestNotFound) {
			return notFound(c, "request not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"request": req}})
}

func (h rfqHandler) addMessage(c *fiber.Ctx) error {
	user := auth.UserID(c)
	if strings.TrimSpace(user) == "" {
		return forbidden(c)
	}
	id := strings.TrimSpace(c.Params("id"))
	var body struct {
		Body     string  `json:"body"`
		QuoteID  *string `json:"quoteId"`
		RoleHint string  `json:"role"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	role := strings.TrimSpace(body.RoleHint)
	if role == "" {
		role = "requester"
	}
	msg, err := h.store.AddMessage(c.Context(), id, rfq.MessageInput{
		AuthorUUID: user,
		AuthorRole: role,
		Body:       body.Body,
		QuoteID:    body.QuoteID,
	})
	if err != nil {
		return serverError(c, err)
	}
	return c.Status(http.StatusCreated).JSON(fiber.Map{"success": true, "data": fiber.Map{"message": msg}})
}

func (h rfqHandler) listProviderRequests(c *fiber.Ctx) error {
	user := auth.UserID(c)
	if strings.TrimSpace(user) == "" {
		return forbidden(c)
	}
	requests, err := h.store.ListRequestsForProvider(c.Context(), user)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"requests": requests}})
}

func (h rfqHandler) getProviderRequest(c *fiber.Ctx) error {
	user := auth.UserID(c)
	id := strings.TrimSpace(c.Params("id"))
	req, err := h.store.GetRequestForProvider(c.Context(), id, user)
	if err != nil {
		if errors.Is(err, rfq.ErrRequestNotFound) {
			return notFound(c, "request not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"request": req}})
}

func (h rfqHandler) updateQuote(c *fiber.Ctx) error {
	user := auth.UserID(c)
	quoteID := strings.TrimSpace(c.Params("id"))
	var body struct {
		AmountCents int64   `json:"amountCents"`
		Currency    string  `json:"currency"`
		Summary     *string `json:"summary"`
		ExpiresAt   *string `json:"expiresAt"`
		Submit      bool    `json:"submit"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	var expires *time.Time
	if body.ExpiresAt != nil {
		if t, err := parseISOTime(*body.ExpiresAt); err == nil {
			expires = &t
		}
	}
	quote, err := h.store.SubmitQuote(c.Context(), user, quoteID, rfq.QuoteInput{
		AmountCents: body.AmountCents,
		Currency:    body.Currency,
		Summary:     body.Summary,
		ExpiresAt:   expires,
		Submit:      body.Submit,
	})
	if err != nil {
		if errors.Is(err, rfq.ErrQuoteNotFound) {
			return notFound(c, "quote not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"quote": quote}})
}

func (h rfqHandler) addProviderMessage(c *fiber.Ctx) error {
	user := auth.UserID(c)
	requestID := strings.TrimSpace(c.Params("id"))
	var body struct {
		Body    string  `json:"body"`
		QuoteID *string `json:"quoteId"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	msg, err := h.store.AddMessage(c.Context(), requestID, rfq.MessageInput{
		AuthorUUID: user,
		AuthorRole: "provider",
		Body:       body.Body,
		QuoteID:    body.QuoteID,
	})
	if err != nil {
		return serverError(c, err)
	}
	return c.Status(http.StatusCreated).JSON(fiber.Map{"success": true, "data": fiber.Map{"message": msg}})
}

func (h rfqHandler) acceptQuote(c *fiber.Ctx) error {
	user := auth.UserID(c)
	quoteID := strings.TrimSpace(c.Params("id"))
	req, err := h.store.AcceptQuote(c.Context(), user, quoteID)
	if err != nil {
		if errors.Is(err, rfq.ErrQuoteNotFound) {
			return notFound(c, "quote not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"request": req}})
}

func (h rfqHandler) rejectQuote(c *fiber.Ctx) error {
	user := auth.UserID(c)
	quoteID := strings.TrimSpace(c.Params("id"))
	req, err := h.store.RejectQuote(c.Context(), user, quoteID)
	if err != nil {
		if errors.Is(err, rfq.ErrQuoteNotFound) {
			return notFound(c, "quote not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"request": req}})
}

func parseISOTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, errors.New("empty")
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t, nil
	}
	if t, err := time.Parse("2006-01-02", value); err == nil {
		return t, nil
	}
	return time.Time{}, errors.New("invalid")
}
