package server

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/auth"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/profile"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/users"
)

func registerProfileRoutes(public fiber.Router, protected fiber.Router, store *profile.Store, db *sqlx.DB) {
	h := profileHandler{store: store, db: db}

	// Authenticated routes
	protected.Get("/profiles/me", h.getMe)
	protected.Put("/profiles/me", h.upsertMe)
	protected.Delete("/profiles/me", h.deleteMe)

	protected.Get("/profiles/me/portfolio", h.listMyPortfolio)
	protected.Post("/profiles/me/portfolio", h.createPortfolioItem)
	protected.Put("/profiles/me/portfolio/:id", h.updatePortfolioItem)
	protected.Delete("/profiles/me/portfolio/:id", h.deletePortfolioItem)

	protected.Get("/profiles/me/certifications", h.listMyCertifications)
	protected.Post("/profiles/me/certifications", h.createCertification)
	protected.Put("/profiles/me/certifications/:id", h.updateCertification)
	protected.Delete("/profiles/me/certifications/:id", h.deleteCertification)

	protected.Get("/profiles/me/reviews", h.listMyReviews)
	protected.Post("/profiles/:userUuid/reviews", h.createReview)
	protected.Delete("/profiles/:userUuid/reviews/:id", h.deleteReview)

	protected.Post("/profiles/:userUuid/certifications/:id/status", h.updateCertificationStatus)
	protected.Post("/profiles/:userUuid/verification", h.setVerificationStatus)

	// Public routes
	public.Get("/profiles/:userUuid", h.getPublic)
	public.Get("/profiles/:userUuid/portfolio", h.listPublicPortfolio)
	public.Get("/profiles/:userUuid/certifications", h.listPublicCertifications)
	public.Get("/profiles/:userUuid/reviews", h.listPublicReviews)
}

type profileHandler struct {
	store *profile.Store
	db    *sqlx.DB
}

// Profile Basics ------------------------------------------------------------------

func (h profileHandler) getMe(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}

	prof, err := h.store.Get(c.Context(), userUUID)
	if err != nil {
		if errors.Is(err, profile.ErrNotFound) {
			empty := h.emptyProfile(userUUID)
			return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": empty}})
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": prof}})
}

func (h profileHandler) upsertMe(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}

	var body upsertProfileRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	params, err := body.toUpdateParams()
	if err != nil {
		return badRequest(c, err.Error())
	}

	prof, err := h.store.Upsert(c.Context(), userUUID, params)
	if err != nil {
		if errors.Is(err, profile.ErrInvalidType) {
			return badRequest(c, "invalid profile type")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": prof}})
}

func (h profileHandler) deleteMe(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	hard := c.QueryBool("hard", false)
	if err := h.store.Delete(c.Context(), userUUID, profile.DeleteParams{Hard: hard}); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h profileHandler) getPublic(c *fiber.Ctx) error {
	userUUID := strings.TrimSpace(c.Params("userUuid"))
	if userUUID == "" {
		return badRequest(c, "invalid user")
	}
	prof, err := h.store.GetPublic(c.Context(), userUUID)
	if err != nil {
		if errors.Is(err, profile.ErrNotFound) {
			return notFound(c, "profile not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": sanitizePublicProfile(*prof)}})
}

// Portfolio -----------------------------------------------------------------------

func (h profileHandler) listMyPortfolio(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	items, err := h.store.ListPortfolio(c.Context(), userUUID, false)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"items": items}})
}

func (h profileHandler) listPublicPortfolio(c *fiber.Ctx) error {
	userUUID := strings.TrimSpace(c.Params("userUuid"))
	if userUUID == "" {
		return badRequest(c, "invalid user")
	}
	items, err := h.store.ListPortfolio(c.Context(), userUUID, true)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"items": items}})
}

func (h profileHandler) createPortfolioItem(c *fiber.Ctx) error {
	return h.savePortfolioItem(c, true)
}

func (h profileHandler) updatePortfolioItem(c *fiber.Ctx) error {
	return h.savePortfolioItem(c, false)
}

func (h profileHandler) savePortfolioItem(c *fiber.Ctx, isCreate bool) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}

	var body portfolioRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if !isCreate {
		id := strings.TrimSpace(c.Params("id"))
		if id == "" {
			return badRequest(c, "invalid portfolio id")
		}
		body.ID = &id
	}
	input := body.toInput()
	if strings.TrimSpace(input.Title) == "" {
		return badRequest(c, "title is required")
	}

	item, err := h.store.SavePortfolioItem(c.Context(), userUUID, input)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"item": item}})
}

func (h profileHandler) deletePortfolioItem(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid portfolio id")
	}
	if err := h.store.DeletePortfolioItem(c.Context(), userUUID, id); err != nil {
		if errors.Is(err, profile.ErrPortfolioNotFound) {
			return notFound(c, "portfolio item not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

// Certifications ------------------------------------------------------------------

func (h profileHandler) listMyCertifications(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	items, err := h.store.ListCertifications(c.Context(), userUUID, false)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"items": items}})
}

func (h profileHandler) listPublicCertifications(c *fiber.Ctx) error {
	userUUID := strings.TrimSpace(c.Params("userUuid"))
	if userUUID == "" {
		return badRequest(c, "invalid user")
	}
	items, err := h.store.ListCertifications(c.Context(), userUUID, true)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"items": items}})
}

func (h profileHandler) createCertification(c *fiber.Ctx) error {
	return h.saveCertification(c, true)
}

func (h profileHandler) updateCertification(c *fiber.Ctx) error {
	return h.saveCertification(c, false)
}

func (h profileHandler) saveCertification(c *fiber.Ctx, isCreate bool) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}

	var body certificationRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if !isCreate {
		id := strings.TrimSpace(c.Params("id"))
		if id == "" {
			return badRequest(c, "invalid certification id")
		}
		body.ID = &id
	}
	input, err := body.toInput()
	if err != nil {
		return badRequest(c, err.Error())
	}
	if strings.TrimSpace(input.Name) == "" {
		return badRequest(c, "name is required")
	}

	item, err := h.store.SaveCertification(c.Context(), userUUID, input)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"item": item}})
}

func (h profileHandler) deleteCertification(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	id := strings.TrimSpace(c.Params("id"))
	if id == "" {
		return badRequest(c, "invalid certification id")
	}
	if err := h.store.DeleteCertification(c.Context(), userUUID, id); err != nil {
		if errors.Is(err, profile.ErrCertificationNotFound) {
			return notFound(c, "certification not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h profileHandler) updateCertificationStatus(c *fiber.Ctx) error {
	requester := auth.UserID(c)
	if strings.TrimSpace(requester) == "" {
		return unauthorized(c)
	}
	if !h.isPrivileged(requester) {
		return forbidden(c)
	}
	userUUID := strings.TrimSpace(c.Params("userUuid"))
	certID := strings.TrimSpace(c.Params("id"))
	if userUUID == "" || certID == "" {
		return badRequest(c, "invalid certification update")
	}

	var body certificationStatusRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	item, err := h.store.UpdateCertificationStatus(c.Context(), userUUID, certID, requester, body.Status, body.Notes)
	if err != nil {
		if errors.Is(err, profile.ErrCertificationNotFound) {
			return notFound(c, "certification not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"item": item}})
}

// Reviews -------------------------------------------------------------------------

func (h profileHandler) listMyReviews(c *fiber.Ctx) error {
	userUUID := auth.UserID(c)
	if strings.TrimSpace(userUUID) == "" {
		return unauthorized(c)
	}
	items, err := h.store.ListReviews(c.Context(), userUUID, false)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"items": items}})
}

func (h profileHandler) listPublicReviews(c *fiber.Ctx) error {
	userUUID := strings.TrimSpace(c.Params("userUuid"))
	if userUUID == "" {
		return badRequest(c, "invalid user")
	}
	items, err := h.store.ListReviews(c.Context(), userUUID, true)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"items": items}})
}

func (h profileHandler) createReview(c *fiber.Ctx) error {
	reviewer := auth.UserID(c)
	if strings.TrimSpace(reviewer) == "" {
		return unauthorized(c)
	}
	target := strings.TrimSpace(c.Params("userUuid"))
	if target == "" {
		return badRequest(c, "invalid user")
	}

	var body reviewRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	input, err := body.toInput()
	if err != nil {
		return badRequest(c, err.Error())
	}
	item, err := h.store.CreateReview(c.Context(), target, reviewer, input)
	if err != nil {
		switch {
		case errors.Is(err, profile.ErrSelfReview):
			return badRequest(c, "you cannot review yourself")
		case errors.Is(err, profile.ErrDuplicateReview):
			return badRequest(c, "review already exists")
		default:
			return serverError(c, err)
		}
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"item": item}})
}

func (h profileHandler) deleteReview(c *fiber.Ctx) error {
	reviewer := auth.UserID(c)
	if strings.TrimSpace(reviewer) == "" {
		return unauthorized(c)
	}
	target := strings.TrimSpace(c.Params("userUuid"))
	reviewID := strings.TrimSpace(c.Params("id"))
	if target == "" || reviewID == "" {
		return badRequest(c, "invalid review")
	}
	allowAdmin := h.isPrivileged(reviewer)
	if err := h.store.DeleteReview(c.Context(), target, reviewer, reviewID, allowAdmin); err != nil {
		if errors.Is(err, profile.ErrReviewNotFound) {
			return notFound(c, "review not found")
		}
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

// Verification --------------------------------------------------------------------

func (h profileHandler) setVerificationStatus(c *fiber.Ctx) error {
	requester := auth.UserID(c)
	if strings.TrimSpace(requester) == "" {
		return unauthorized(c)
	}
	if !h.isPrivileged(requester) {
		return forbidden(c)
	}
	target := strings.TrimSpace(c.Params("userUuid"))
	if target == "" {
		return badRequest(c, "invalid user")
	}

	var body verificationRequest
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid body")
	}
	if strings.TrimSpace(body.Status) == "" {
		return badRequest(c, "status is required")
	}
	prof, err := h.store.SetVerificationStatus(c.Context(), target, requester, body.Status, body.Notes)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": prof}})
}

// Helpers -------------------------------------------------------------------------

func (h profileHandler) emptyProfile(userUUID string) profile.Profile {
	return profile.Profile{
		UserUUID:           userUUID,
		ProfileType:        users.ProfileHomeowner,
		Specialties:        []string{},
		IsPublic:           true,
		CompletionSections: map[string]bool{},
		VerificationStatus: "pending",
		Portfolio:          []profile.PortfolioItem{},
		Certifications:     []profile.Certification{},
		ReviewSummary:      profile.ReviewSummary{},
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}
}

func (h profileHandler) isPrivileged(userUUID string) bool {
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

func sanitizePublicProfile(p profile.Profile) profile.Profile {
	p.VerificationNotes = nil
	return p
}

func unauthorized(c *fiber.Ctx) error {
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "message": "unauthorized"})
}

func forbidden(c *fiber.Ctx) error {
	return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"success": false, "message": "forbidden"})
}

func badRequest(c *fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": msg})
}

func notFound(c *fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "message": msg})
}

func serverError(c *fiber.Ctx, err error) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": "server error"})
}

func hasRoleKey(db *sqlx.DB, userUUID, role string) bool {
	if db == nil || strings.TrimSpace(userUUID) == "" || strings.TrimSpace(role) == "" {
		return false
	}
	var exists bool
	_ = db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_uuid=$1 AND role_key=$2)", userUUID, role)
	return exists
}

func isPlatformAdmin(db *sqlx.DB, userUUID string) bool {
	if db == nil || strings.TrimSpace(userUUID) == "" {
		return false
	}
	var exists bool
	_ = db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_uuid=$1 AND (role_key=$2 OR role_key=$3 OR role_key LIKE $4))",
		userUUID, "admin", "platform.admin", "%.admin")
	return exists
}

// Request DTOs --------------------------------------------------------------------

type upsertProfileRequest struct {
	ProfileType *string   `json:"profileType"`
	DisplayName *string   `json:"displayName"`
	Headline    *string   `json:"headline"`
	CompanyName *string   `json:"companyName"`
	Phone       *string   `json:"phone"`
	Website     *string   `json:"website"`
	Location    *string   `json:"location"`
	Bio         *string   `json:"bio"`
	Specialties *[]string `json:"specialties"`
	AvatarURL   *string   `json:"avatarUrl"`
	IsPublic    *bool     `json:"isPublic"`
}

func (r upsertProfileRequest) toUpdateParams() (profile.UpdateParams, error) {
	var params profile.UpdateParams
	if r.ProfileType != nil {
		trimmed := strings.ToLower(strings.TrimSpace(*r.ProfileType))
		pt := users.ProfileType(trimmed)
		if users.ProviderRoleByType[pt] == "" {
			return params, errors.New("invalid profile type")
		}
		params.ProfileType = &pt
	}
	params.DisplayName = normalizePtr(r.DisplayName)
	params.Headline = normalizePtr(r.Headline)
	params.CompanyName = normalizePtr(r.CompanyName)
	params.Phone = normalizePtr(r.Phone)
	params.Website = normalizePtr(r.Website)
	params.Location = normalizePtr(r.Location)
	params.Bio = normalizePtr(r.Bio)
	if r.Specialties != nil {
		cleaned := make([]string, 0, len(*r.Specialties))
		for _, v := range *r.Specialties {
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				cleaned = append(cleaned, trimmed)
			}
		}
		params.Specialties = &cleaned
	}
	params.AvatarURL = normalizePtr(r.AvatarURL)
	if r.IsPublic != nil {
		params.IsPublic = r.IsPublic
	}
	return params, nil
}

type portfolioRequest struct {
	ID          *string  `json:"id"`
	Title       string   `json:"title"`
	Description *string  `json:"description"`
	MediaURL    *string  `json:"mediaUrl"`
	Tags        []string `json:"tags"`
	IsPublic    *bool    `json:"isPublic"`
	Position    *int     `json:"position"`
}

func (r portfolioRequest) toInput() profile.PortfolioInput {
	return profile.PortfolioInput{
		ID:          normalizePtr(r.ID),
		Title:       strings.TrimSpace(r.Title),
		Description: normalizePtr(r.Description),
		MediaURL:    normalizePtr(r.MediaURL),
		Tags:        r.Tags,
		IsPublic:    r.IsPublic,
		Position:    r.Position,
	}
}

type certificationRequest struct {
	ID            *string `json:"id"`
	Name          string  `json:"name"`
	Issuer        *string `json:"issuer"`
	IssuedOn      *string `json:"issuedOn"`
	ExpiresOn     *string `json:"expiresOn"`
	CredentialID  *string `json:"credentialId"`
	CredentialURL *string `json:"credentialUrl"`
}

func (r certificationRequest) toInput() (profile.CertificationInput, error) {
	var issued *time.Time
	var expires *time.Time
	var err error

	if r.IssuedOn != nil && strings.TrimSpace(*r.IssuedOn) != "" {
		if issued, err = parseDate(*r.IssuedOn); err != nil {
			return profile.CertificationInput{}, err
		}
	}
	if r.ExpiresOn != nil && strings.TrimSpace(*r.ExpiresOn) != "" {
		if expires, err = parseDate(*r.ExpiresOn); err != nil {
			return profile.CertificationInput{}, err
		}
	}

	return profile.CertificationInput{
		ID:            normalizePtr(r.ID),
		Name:          strings.TrimSpace(r.Name),
		Issuer:        normalizePtr(r.Issuer),
		IssuedOn:      issued,
		ExpiresOn:     expires,
		CredentialID:  normalizePtr(r.CredentialID),
		CredentialURL: normalizePtr(r.CredentialURL),
	}, nil
}

type certificationStatusRequest struct {
	Status string  `json:"status"`
	Notes  *string `json:"notes"`
}

type reviewRequest struct {
	Rating   int     `json:"rating"`
	Title    *string `json:"title"`
	Comment  *string `json:"comment"`
	IsPublic *bool   `json:"isPublic"`
}

func (r reviewRequest) toInput() (profile.ReviewInput, error) {
	if r.Rating < 1 || r.Rating > 5 {
		return profile.ReviewInput{}, errors.New("rating must be between 1 and 5")
	}
	return profile.ReviewInput{
		Rating:   r.Rating,
		Title:    normalizePtr(r.Title),
		Comment:  normalizePtr(r.Comment),
		IsPublic: r.IsPublic,
	}, nil
}

type verificationRequest struct {
	Status string  `json:"status"`
	Notes  *string `json:"notes"`
}

// Utility -------------------------------------------------------------------------

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

func parseDate(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if ts, err := time.Parse("2006-01-02", value); err == nil {
		return &ts, nil
	}
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		t := time.Unix(seconds, 0).UTC()
		return &t, nil
	}
	return nil, errors.New("invalid date format (expected YYYY-MM-DD)")
}
