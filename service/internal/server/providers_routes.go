package server

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/auth"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/categories"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/coreapi"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/providers"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/users"
)

type providerHandler struct {
	store      *providers.Store
	db         *sqlx.DB
	core       *coreapi.Client
	log        *slog.Logger
	categories *categories.Store
}

func registerProviderRoutes(
	public fiber.Router,
	protected fiber.Router,
	store *providers.Store,
	db *sqlx.DB,
	coreClient *coreapi.Client,
	logger *slog.Logger,
) {
	catStore := store.Categories()
	if catStore == nil && db != nil {
		catStore = categories.NewStore(db)
	}
	h := providerHandler{
		store:      store,
		db:         db,
		core:       coreClient,
		log:        logger,
		categories: catStore,
	}

	// Public endpoints
	public.Get("/providers/search", h.searchProviders)
	public.Get("/providers/categories", h.listCategories)
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
	protected.Post("/providers/categories", h.upsertCategory)
	protected.Post("/providers/categories/:categoryKey/subcategories", h.upsertSubcategory)
	protected.Post("/providers/categories/:categoryKey/attributes", h.upsertAttribute)
	protected.Get("/providers/favorites", h.listFavorites)
	protected.Post("/providers/favorites/:listingId", h.addFavorite)
	protected.Delete("/providers/favorites/:listingId", h.removeFavorite)
	protected.Get("/providers/search/history", h.getSearchHistory)
	protected.Get("/providers/recommended", h.getRecommended)

	protected.Get("/providers/listings/:id/availability", h.getAvailability)
	protected.Put("/providers/listings/:id/availability", h.setAvailability)

	protected.Get("/providers/listings/:id/areas", h.getServiceAreas)
	protected.Put("/providers/listings/:id/areas", h.setServiceAreas)

	protected.Post("/providers/response-events", h.recordResponseEvent)
	protected.Get("/providers/analytics", h.getAnalytics)
}

// Search ------------------------------------------------------------------------

func (h providerHandler) searchProviders(c *fiber.Ctx) error {
	filters := providers.SearchFilters{
		Query: strings.TrimSpace(c.Query("q")),
	}
	filters.Categories = queryList(c, "category")
	filters.Subcategories = queryList(c, "subcategory")
	filters.CountryCodes = queryList(c, "country")
	filters.Region = strings.TrimSpace(c.Query("region"))

	if v := strings.TrimSpace(c.Query("lat")); v != "" {
		lat, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return badRequest(c, "lat must be numeric")
		}
		filters.Latitude = &lat
	}
	if v := strings.TrimSpace(c.Query("lng")); v != "" {
		lng, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return badRequest(c, "lng must be numeric")
		}
		filters.Longitude = &lng
	}
	if v := strings.TrimSpace(c.Query("radiusKm")); v != "" {
		radius, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return badRequest(c, "radiusKm must be numeric")
		}
		filters.RadiusKm = &radius
	}

	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		limit, err := strconv.Atoi(v)
		if err != nil {
			return badRequest(c, "limit must be a number")
		}
		filters.Limit = limit
	}
	if v := strings.TrimSpace(c.Query("offset")); v != "" {
		offset, err := strconv.Atoi(v)
		if err != nil {
			return badRequest(c, "offset must be a number")
		}
		filters.Offset = offset
	}

	if v := strings.TrimSpace(c.Query("minPrice")); v != "" {
		minPrice, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return badRequest(c, "minPrice must be numeric")
		}
		filters.MinPriceCents = int64(math.Round(minPrice * 100))
	}
	if v := strings.TrimSpace(c.Query("maxPrice")); v != "" {
		maxPrice, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return badRequest(c, "maxPrice must be numeric")
		}
		filters.MaxPriceCents = int64(math.Round(maxPrice * 100))
	}
	if v := strings.TrimSpace(c.Query("minRating")); v != "" {
		minRating, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return badRequest(c, "minRating must be numeric")
		}
		filters.MinRating = minRating
	}

	if v := strings.TrimSpace(c.Query("dayOfWeek")); v != "" {
		day, err := strconv.Atoi(v)
		if err != nil {
			return badRequest(c, "dayOfWeek must be numeric")
		}
		filters.DayOfWeek = &day
	}
	if v := strings.TrimSpace(c.Query("startMinute")); v != "" {
		start, err := strconv.Atoi(v)
		if err != nil {
			return badRequest(c, "startMinute must be numeric")
		}
		filters.StartMinute = &start
	}
	if v := strings.TrimSpace(c.Query("endMinute")); v != "" {
		end, err := strconv.Atoi(v)
		if err != nil {
			return badRequest(c, "endMinute must be numeric")
		}
		filters.EndMinute = &end
	}

	filters.Limit = limitOrDefault(filters.Limit)

	results, err := h.store.SearchPublicListings(c.Context(), filters)
	if err != nil {
		if isCategoryValidationError(err) {
			return badRequest(c, err.Error())
		}
		return serverError(c, err)
	}

	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) != "" {
		_ = h.store.RecordSearch(c.Context(), userUUID, filters)
		favorites, favErr := h.store.FavoriteIDs(c.Context(), userUUID)
		if favErr == nil && len(favorites) > 0 {
			for idx := range results {
				if _, ok := favorites[results[idx].Listing.ID]; ok {
					if results[idx].Listing.Attributes == nil {
						results[idx].Listing.Attributes = map[string]any{}
					}
					results[idx].Listing.Attributes["favorited"] = true
				}
			}
		}
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"results": results,
			"meta": fiber.Map{
				"limit":  limitOrDefault(filters.Limit),
				"offset": filters.Offset,
				"count":  len(results),
			},
		},
	})
}

// Categories --------------------------------------------------------------------

func (h providerHandler) listCategories(c *fiber.Ctx) error {
	if h.categories == nil {
		return serverError(c, errors.New("categories store unavailable"))
	}
	cats, err := h.categories.List(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"categories": cats}})
}

func (h providerHandler) upsertCategory(c *fiber.Ctx) error {
	requester := auth.UserID(c)
	if !h.isPrivileged(requester) {
		return forbidden(c)
	}
	if h.categories == nil {
		return serverError(c, errors.New("categories store unavailable"))
	}
	var body struct {
		Key         string  `json:"key"`
		Name        string  `json:"name"`
		Description *string `json:"description"`
		Icon        *string `json:"icon"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if strings.TrimSpace(body.Key) == "" || strings.TrimSpace(body.Name) == "" {
		return badRequest(c, "key and name are required")
	}
	category, err := h.categories.UpsertCategory(c.Context(), body.Key, body.Name, body.Description, body.Icon)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"category": category}})
}

func (h providerHandler) upsertSubcategory(c *fiber.Ctx) error {
	requester := auth.UserID(c)
	if !h.isPrivileged(requester) {
		return forbidden(c)
	}
	if h.categories == nil {
		return serverError(c, errors.New("categories store unavailable"))
	}
	categoryKey := strings.TrimSpace(c.Params("categoryKey"))
	if categoryKey == "" {
		return badRequest(c, "category key required")
	}
	var body struct {
		Key         string         `json:"key"`
		Name        string         `json:"name"`
		Description *string        `json:"description"`
		Filters     map[string]any `json:"filters"`
		Position    *int           `json:"position"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if strings.TrimSpace(body.Key) == "" || strings.TrimSpace(body.Name) == "" {
		return badRequest(c, "key and name are required")
	}
	position := 0
	if body.Position != nil && *body.Position > 0 {
		position = *body.Position
	}
	sub, err := h.categories.UpsertSubcategory(c.Context(), categoryKey, body.Key, body.Name, body.Description, body.Filters, position)
	if err != nil {
		if errors.Is(err, categories.ErrCategoryNotFound) {
			return notFound(c, "category not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"subcategory": sub}})
}

func (h providerHandler) upsertAttribute(c *fiber.Ctx) error {
	requester := auth.UserID(c)
	if !h.isPrivileged(requester) {
		return forbidden(c)
	}
	if h.categories == nil {
		return serverError(c, errors.New("categories store unavailable"))
	}
	categoryKey := strings.TrimSpace(c.Params("categoryKey"))
	if categoryKey == "" {
		return badRequest(c, "category key required")
	}
	var body struct {
		Key          string         `json:"key"`
		Label        string         `json:"label"`
		DataType     string         `json:"dataType"`
		Required     bool           `json:"required"`
		FilterConfig map[string]any `json:"filterConfig"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if strings.TrimSpace(body.Key) == "" || strings.TrimSpace(body.Label) == "" {
		return badRequest(c, "key and label are required")
	}
	if strings.TrimSpace(body.DataType) == "" {
		body.DataType = "string"
	}
	attr, err := h.categories.UpsertAttribute(c.Context(), categoryKey, body.Key, body.Label, body.DataType, body.Required, body.FilterConfig)
	if err != nil {
		if errors.Is(err, categories.ErrCategoryNotFound) {
			return notFound(c, "category not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"attribute": attr}})
}

func (h providerHandler) listFavorites(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	limit := 50
	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	listings, err := h.store.ListFavorites(c.Context(), userUUID, limit)
	if err != nil {
		return serverError(c, err)
	}
	for i := range listings {
		if listings[i].Attributes == nil {
			listings[i].Attributes = map[string]any{}
		}
		listings[i].Attributes["favorited"] = true
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"listings": listings}})
}

func (h providerHandler) addFavorite(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	listingID := strings.TrimSpace(c.Params("listingId"))
	if listingID == "" {
		return badRequest(c, "listing id required")
	}
	if err := h.store.AddFavorite(c.Context(), userUUID, listingID); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h providerHandler) removeFavorite(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	listingID := strings.TrimSpace(c.Params("listingId"))
	if listingID == "" {
		return badRequest(c, "listing id required")
	}
	if err := h.store.RemoveFavorite(c.Context(), userUUID, listingID); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h providerHandler) getSearchHistory(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	limit := 10
	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	history, err := h.store.RecentSearches(c.Context(), userUUID, limit)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"history": history}})
}

func (h providerHandler) getRecommended(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	limit := 12
	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	results, err := h.store.RecommendationsForUser(c.Context(), userUUID, limit)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"results": results}})
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
		if isCategoryValidationError(err) {
			return badRequest(c, err.Error())
		}
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
		if isCategoryValidationError(err) {
			return badRequest(c, err.Error())
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

func isCategoryValidationError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, categories.ErrCategoryNotFound) || errors.Is(err, categories.ErrSubcategoryNotFound) {
		return true
	}
	return strings.HasPrefix(err.Error(), "categories:")
}

func queryList(c *fiber.Ctx, key string) []string {
	var values []string
	args := c.Context().QueryArgs()
	if args == nil {
		return values
	}
	args.VisitAll(func(k, v []byte) {
		if strings.EqualFold(string(k), key) {
			parts := strings.Split(string(v), ",")
			for _, part := range parts {
				if trimmed := strings.TrimSpace(part); trimmed != "" {
					values = append(values, trimmed)
				}
			}
		}
	})
	return values
}

func limitOrDefault(limit int) int {
	if limit <= 0 || limit > 100 {
		return 20
	}
	return limit
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
	Region      string   `json:"region"`
	CountryCode *string  `json:"countryCode"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
	Notes       *string  `json:"notes"`
}

func (r serviceAreaRequest) toAreas() []providers.ServiceArea {
	areas := make([]providers.ServiceArea, 0, len(r.Areas))
	for _, area := range r.Areas {
		areas = append(areas, providers.ServiceArea{
			Region:      strings.TrimSpace(area.Region),
			CountryCode: area.CountryCode,
			Latitude:    area.Latitude,
			Longitude:   area.Longitude,
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
