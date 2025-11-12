package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/auth"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/coreapi"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/providers"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/users"
)

type providerHandler struct {
	store *providers.Store
	db    *sqlx.DB
	core  *coreapi.Client
	log   *slog.Logger
}

func registerProviderRoutes(
	public fiber.Router,
	protected fiber.Router,
	store *providers.Store,
	db *sqlx.DB,
	coreClient *coreapi.Client,
	logger *slog.Logger,
) {
	h := providerHandler{
		store: store,
		db:    db,
		core:  coreClient,
		log:   logger,
	}

	// Public endpoints
	public.Get("/providers/listings", h.listPublicListings)

	// Authenticated provider endpoints
	protected.Get("/providers/me/listings", h.listMyListings)
	protected.Post("/providers/onboarding", h.submitOnboarding)
	protected.Get("/providers/onboarding/status", h.getOnboardingStatus)
	protected.Get("/providers/onboarding/pending", h.listPendingOnboarding)
	protected.Post("/providers/onboarding/:userUuid/review", h.reviewOnboarding)

	protected.Post("/providers/listings", h.createListing)
	protected.Put("/providers/listings/:id", h.updateListing)
	protected.Delete("/providers/listings/:id", h.deleteListing)

	protected.Get("/providers/listings/:id/availability", h.getAvailability)
	protected.Put("/providers/listings/:id/availability", h.setAvailability)

	protected.Get("/providers/listings/:id/areas", h.getServiceAreas)
	protected.Put("/providers/listings/:id/areas", h.setServiceAreas)

	protected.Post("/providers/response-events", h.recordResponseEvent)
	protected.Get("/providers/analytics", h.getAnalytics)
}

// Onboarding ---------------------------------------------------------------------

func (h providerHandler) submitOnboarding(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	var body struct {
		ProfileType string `json:"profileType"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if strings.TrimSpace(body.ProfileType) == "" {
		return badRequest(c, "profileType is required")
	}
	status, err := h.store.Submit(c.Context(), userUUID, users.ProfileType(strings.ToLower(body.ProfileType)))
	if err != nil && !errors.Is(err, providers.ErrAlreadyProvider) {
		if errors.Is(err, providers.ErrInvalidProfile) {
			return badRequest(c, err.Error())
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"status": status}})
}

func (h providerHandler) getOnboardingStatus(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	status, err := h.store.Status(c.Context(), userUUID)
	if err != nil {
		if errors.Is(err, providers.ErrNotEnrolled) {
			return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"status": nil}})
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"status": status}})
}

func (h providerHandler) listPendingOnboarding(c *fiber.Ctx) error {
	requester := auth.UserID(c)
	if !h.isPrivileged(requester) {
		return forbidden(c)
	}
	statuses, err := h.store.ListPending(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"requests": statuses}})
}

func (h providerHandler) reviewOnboarding(c *fiber.Ctx) error {
	requester := auth.UserID(c)
	if !h.isPrivileged(requester) {
		return forbidden(c)
	}
	target := strings.TrimSpace(c.Params("userUuid"))
	if target == "" {
		return badRequest(c, "invalid user")
	}
	var body struct {
		Stage string  `json:"stage"`
		Notes *string `json:"notes"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if strings.TrimSpace(body.Stage) == "" {
		return badRequest(c, "stage is required")
	}
	status, err := h.store.SetStage(c.Context(), target, body.Stage, requester, body.Notes)
	if err != nil {
		if errors.Is(err, providers.ErrNotEnrolled) {
			return notFound(c, "onboarding not found")
		}
		return serverError(c, err)
	}
	if status.Stage == "approved" {
		h.assignProviderRoles(c.Context(), status)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"status": status}})
}

// Listings -----------------------------------------------------------------------

func (h providerHandler) listMyListings(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	listings, err := h.store.ListListingsByUser(c.Context(), status.UserUUID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"listings": listings}})
}

func (h providerHandler) createListing(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	var body listingRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if strings.TrimSpace(body.Title) == "" {
		return badRequest(c, "title is required")
	}
	listing, err := h.store.CreateListing(c.Context(), status.UserUUID, body.toInput())
	if err != nil {
		return serverError(c, err)
	}
	return c.Status(http.StatusCreated).JSON(fiber.Map{"success": true, "data": fiber.Map{"listing": listing}})
}

func (h providerHandler) updateListing(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid listing id")
	}
	var body listingRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	listing, err := h.store.UpdateListing(c.Context(), status.UserUUID, id, body.toInput())
	if err != nil {
		if errors.Is(err, providers.ErrNotEnrolled) || errors.Is(err, providers.ErrListingNotFound) {
			return notFound(c, "listing not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"listing": listing}})
}

func (h providerHandler) deleteListing(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid listing id")
	}
	if err := h.store.DeleteListing(c.Context(), status.UserUUID, id); err != nil {
		if errors.Is(err, providers.ErrListingNotFound) {
			return notFound(c, "listing not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h providerHandler) listPublicListings(c *fiber.Ctx) error {
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}
	listings, err := h.store.ListPublicListings(c.Context(), limit)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"listings": listings}})
}

// Availability -------------------------------------------------------------------

func (h providerHandler) getAvailability(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid listing id")
	}
	if err := h.ensureListingOwner(c.Context(), status.UserUUID, id); err != nil {
		if errors.Is(err, providers.ErrListingNotFound) {
			return notFound(c, "listing not found")
		}
		return serverError(c, err)
	}
	slots, err := h.store.GetAvailability(c.Context(), id)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"slots": slots}})
}

func (h providerHandler) setAvailability(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid listing id")
	}
	var body availabilityRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	slots := body.toSlots()
	if err := h.store.SetAvailability(c.Context(), id, status.UserUUID, slots); err != nil {
		return badRequest(c, err.Error())
	}
	return c.JSON(fiber.Map{"success": true})
}

// Service Areas ------------------------------------------------------------------

func (h providerHandler) getServiceAreas(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid listing id")
	}
	if err := h.ensureListingOwner(c.Context(), status.UserUUID, id); err != nil {
		if errors.Is(err, providers.ErrListingNotFound) {
			return notFound(c, "listing not found")
		}
		return serverError(c, err)
	}
	areas, err := h.store.GetServiceAreas(c.Context(), id)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"areas": areas}})
}

func (h providerHandler) setServiceAreas(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid listing id")
	}
	var body serviceAreaRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if err := h.store.SetServiceAreas(c.Context(), id, status.UserUUID, body.toAreas()); err != nil {
		return badRequest(c, err.Error())
	}
	return c.JSON(fiber.Map{"success": true})
}

// Response & Analytics -----------------------------------------------------------

func (h providerHandler) recordResponseEvent(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	var body responseEventRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if err := h.store.RecordResponse(c.Context(), status.UserUUID, body.ElapsedMinutes, body.JobCompleted); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h providerHandler) getAnalytics(c *fiber.Ctx) error {
	status, err := h.requireApprovedProvider(c)
	if err != nil {
		return err
	}
	data, err := h.store.GetAnalytics(c.Context(), status.UserUUID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"analytics": data}})
}

// Helpers ------------------------------------------------------------------------

func (h providerHandler) requireApprovedProvider(c *fiber.Ctx) (providers.OnboardingStatus, error) {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		_ = unauthorized(c)
		return providers.OnboardingStatus{}, fiber.ErrUnauthorized
	}
	status, err := h.store.Status(c.Context(), userUUID)
	if err != nil {
		if errors.Is(err, providers.ErrNotEnrolled) {
			_ = forbiddenWithMessage(c, "provider onboarding not started")
			return providers.OnboardingStatus{}, fiber.ErrForbidden
		}
		_ = serverError(c, err)
		return providers.OnboardingStatus{}, fiber.ErrInternalServerError
	}
	if status.Stage != "approved" {
		_ = forbiddenWithMessage(c, "provider onboarding not approved yet")
		return providers.OnboardingStatus{}, fiber.ErrForbidden
	}
	return status, nil
}

func (h providerHandler) ensureListingOwner(ctx context.Context, userUUID, listingID string) error {
	return h.store.EnsureListingOwner(ctx, listingID, userUUID)
}

func (h providerHandler) assignProviderRoles(ctx context.Context, status providers.OnboardingStatus) {
	if h.core == nil {
		return
	}
	roleKey := users.ProviderRoleByType[status.ProfileType]
	if roleKey == "" {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := h.core.EnrollApp(ctx, "architect", status.UserUUID); err != nil && h.log != nil {
		h.log.Warn("failed to enroll provider app", "user", status.UserUUID, "error", err)
	}
	if err := h.core.AddAppRole(ctx, "architect", string(users.RoleArchitectProvider), status.UserUUID); err != nil && h.log != nil {
		h.log.Warn("failed to assign provider base role", "user", status.UserUUID, "error", err)
	}
	if err := h.core.AddAppRole(ctx, "architect", string(roleKey), status.UserUUID); err != nil && h.log != nil {
		h.log.Warn("failed to assign provider subtype role", "user", status.UserUUID, "role", roleKey, "error", err)
	}
}

func (h providerHandler) isPrivileged(userUUID string) bool {
	if strings.TrimSpace(userUUID) == "" {
		return false
	}
	if isPlatformAdmin(h.db, userUUID) {
		return true
	}
	if hasRoleKey(h.db, userUUID, string(users.RoleArchitectAdmin)) {
		return true
	}
	if hasRoleKey(h.db, userUUID, string(users.RoleArchitectSupport)) {
		return true
	}
	return false
}

// Request payload adapters -------------------------------------------------------

type listingRequest struct {
	Title          string  `json:"title"`
	Summary        *string `json:"summary"`
	Description    *string `json:"description"`
	Category       string  `json:"category"`
	PricingModel   string  `json:"pricingModel"`
	BasePriceCents int64   `json:"basePriceCents"`
	Currency       string  `json:"currency"`
	Status         string  `json:"status"`
}

func (r listingRequest) toInput() providers.ListingInput {
	return providers.ListingInput{
		Title:          strings.TrimSpace(r.Title),
		Summary:        r.Summary,
		Description:    r.Description,
		Category:       r.Category,
		PricingModel:   r.PricingModel,
		BasePriceCents: r.BasePriceCents,
		Currency:       r.Currency,
		Status:         r.Status,
	}
}

type availabilityRequest struct {
	Slots []availabilitySlotPayload `json:"slots"`
}

type availabilitySlotPayload struct {
	DayOfWeek   int `json:"dayOfWeek"`
	StartMinute int `json:"startMinute"`
	EndMinute   int `json:"endMinute"`
}

func (r availabilityRequest) toSlots() []providers.AvailabilitySlot {
	slots := make([]providers.AvailabilitySlot, 0, len(r.Slots))
	for _, slot := range r.Slots {
		slots = append(slots, providers.AvailabilitySlot{
			DayOfWeek:   slot.DayOfWeek,
			StartMinute: slot.StartMinute,
			EndMinute:   slot.EndMinute,
		})
	}
	return slots
}

type serviceAreaRequest struct {
	Areas []serviceAreaPayload `json:"areas"`
}

type serviceAreaPayload struct {
	Region      string  `json:"region"`
	CountryCode *string `json:"countryCode"`
	Notes       *string `json:"notes"`
}

func (r serviceAreaRequest) toAreas() []providers.ServiceArea {
	areas := make([]providers.ServiceArea, 0, len(r.Areas))
	for _, area := range r.Areas {
		areas = append(areas, providers.ServiceArea{
			Region:      strings.TrimSpace(area.Region),
			CountryCode: area.CountryCode,
			Notes:       area.Notes,
		})
	}
	return areas
}

type responseEventRequest struct {
	ElapsedMinutes float64 `json:"elapsedMinutes"`
	JobCompleted   bool    `json:"jobCompleted"`
}

func forbiddenWithMessage(c *fiber.Ctx, message string) error {
	return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"success": false, "message": message})
}
