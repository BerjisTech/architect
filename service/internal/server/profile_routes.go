package server

import (
	"errors"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/berjistech/berjis-ecosystem/architect/service/internal/auth"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/profile"
	"github.com/berjistech/berjis-ecosystem/architect/service/internal/users"
)

type profileHandler struct {
	store *profile.Store
}

func registerProfileRoutes(router fiber.Router, store *profile.Store) {
	h := profileHandler{store: store}
	router.Get("/profiles/me", h.getMe)
	router.Put("/profiles/me", h.upsertMe)
	router.Delete("/profiles/me", h.deleteMe)
	router.Get("/profiles/:userUuid", h.getPublic)
}

func (h profileHandler) getMe(c *fiber.Ctx) error {
	userUuid := auth.UserID(c)
	if strings.TrimSpace(userUuid) == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "message": "unauthorized"})
	}

	prof, err := h.store.Get(c.Context(), userUuid)
	if err != nil {
		if errors.Is(err, profile.ErrNotFound) {
			return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": h.emptyProfile(userUuid)}})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}

	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": prof}})
}

func (h profileHandler) upsertMe(c *fiber.Ctx) error {
	userUuid := auth.UserID(c)
	if strings.TrimSpace(userUuid) == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "message": "unauthorized"})
	}

	var body upsertProfileRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "invalid body"})
	}

	params, err := body.toUpdateParams()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": err.Error()})
	}

	prof, err := h.store.Upsert(c.Context(), userUuid, params)
	if err != nil {
		if errors.Is(err, profile.ErrInvalidType) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "invalid profile type"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}

	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": prof}})
}

func (h profileHandler) deleteMe(c *fiber.Ctx) error {
	userUuid := auth.UserID(c)
	if strings.TrimSpace(userUuid) == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "message": "unauthorized"})
	}

	hard := c.QueryBool("hard", false)
	if err := h.store.Delete(c.Context(), userUuid, profile.DeleteParams{Hard: hard}); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h profileHandler) getPublic(c *fiber.Ctx) error {
	userUuid := strings.TrimSpace(c.Params("userUuid"))
	if userUuid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "invalid user"})
	}

	prof, err := h.store.GetPublic(c.Context(), userUuid)
	if err != nil {
		if errors.Is(err, profile.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "message": "not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}

	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"profile": sanitizePublicProfile(*prof)}})
}

func (h profileHandler) emptyProfile(userUuid string) profile.Profile {
	return profile.Profile{
		UserUUID:           userUuid,
		ProfileType:        users.ProfileHomeowner,
		Specialties:        []string{},
		IsPublic:           true,
		CompletionSections: map[string]bool{},
		VerificationStatus: "pending",
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}
}

func sanitizePublicProfile(p profile.Profile) profile.Profile {
	p.VerificationNotes = nil
	return p
}

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
		if !allowedProfileType(trimmed) {
			return params, profile.ErrInvalidType
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

func allowedProfileType(v string) bool {
	return users.ProviderRoleByType[users.ProfileType(strings.ToLower(strings.TrimSpace(v)))] != ""
}
