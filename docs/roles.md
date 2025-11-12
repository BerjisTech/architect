# Architect Roles & Profile Types

This document defines the role taxonomy for the Architect app (`architect.berjis.tech`) and the profile types used to model service providers. Roles follow the Berjis ecosystem conventions from `AGENTS.md`:

- Platform-wide authorities are always named `platform.<role>`.
- App-scoped authorities use `<app>.<role>`.
- Downstream services **never** mint tokens or roles; they consume metadata from `api.berjis.tech`.

## Platform Roles

| Role Key         | Scope     | Purpose                                                         |
| ---------------- | --------- | --------------------------------------------------------------- |
| `platform.admin` | Platform  | Global superuser; can override any app-level permission.        |
| `platform.support` | Platform | Handles cross-app escalations, refunds, and user account issues. |

Platform roles are provisioned centrally and already exposed by `/v1/auth/verify`. The Architect app must treat these as top-level overrides.

## Architect App Roles

| Role Key                      | Category          | Default Assignment                                  | Summary                                                                 |
| ----------------------------- | ----------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| `architect.admin`             | Admin             | Manual assignment by platform/architect admins      | Full control of Architect app configuration, provider verification, disputes, and content moderation. |
| `architect.support`           | Operations        | Manual assignment                                    | Handles day-to-day support tickets, provider onboarding reviews, and dispute triage without full configuration privileges. |
| `architect.homeowner`         | Regular User      | Granted on first enrollment into Architect app      | Home builders / property owners. Can create projects, use the studio, request quotes, and purchase plans. |
| `architect.provider`          | Provider (base)   | Granted alongside any provider-specialised role     | Enables provider workspace, listings, quotes, project collaboration, inbox, and payouts. |
| `architect.architect`         | Provider subtype  | Self-enrollment (subject to verification)           | Licensed architects and design consultants. Unlocks design studio collaboration features and plan submissions. |
| `architect.quantity_surveyor` | Provider subtype  | Self-enrollment (verification required)             | Quantity surveyors/cost estimators. Adds BoQ tooling, budget dashboards, and cost report publishing permissions. |
| `architect.land_surveyor`     | Provider subtype  | Self-enrollment (verification required)             | Land and geospatial surveyors. Access to site assessment uploads, survey scheduling, and GIS overlays. |
| `architect.lawyer`            | Provider subtype  | Self-enrollment (verification required)             | Construction and property lawyers. Can offer legal packages, contract reviews, and compliance checklists. |
| `architect.material_supplier` | Provider subtype  | Self-enrollment (verification required)             | Suppliers of construction materials/finishes. Manage catalogues, inventory exposure, and bulk order quotes. |
| `architect.contractor`        | Provider subtype  | Self-enrollment (verification required)             | General contractors or specialty trades. Manage crews, bids, schedules, and project execution. |
| `architect.handyman`          | Provider subtype  | Self-enrollment (verification required)             | Small job and maintenance providers. Can accept quick tasks and small refurbishments. |
| `architect.interior_designer` | Provider subtype  | Self-enrollment (verification required)             | Interior designers/stylists. Can upload portfolios, asset packs, and offer design services. |
| `architect.mover`             | Provider subtype  | Self-enrollment (verification required)             | Moving/logistics specialists. Manage relocation services and scheduling. |

> **Note:** Future provider specialisations (e.g., structural engineer, MEP engineer) should follow the same `architect.<role>` pattern and inherit `architect.provider`.

### Role Hierarchy

- `platform.admin` supersedes every other role.
- `architect.admin` inherits every permission of `architect.support`, `architect.provider`, and `architect.homeowner`.
- `architect.support` inherits read-only access to most admin dashboards (tickets, disputes, provider verification) but cannot change pricing, platform settings, or destructive actions.
- Each provider subtype role automatically implies `architect.provider`.
- `architect.provider` and `architect.homeowner` are mutually inclusive—users may hold both when acting as owner and provider on different projects.

## Permissions Matrix

| Capability / Module                                            | platform.admin | architect.admin | architect.support | architect.provider\* | architect.homeowner |
| -------------------------------------------------------------- | -------------- | --------------- | ----------------- | ------------------- | ------------------- |
| Access Architect application (enroll in `user_apps`)           | ✅             | ✅              | ✅                | ✅                  | ✅                  |
| Create & manage personal projects                              | ✅             | ✅              | 🔍 read-only      | ✅ (for partnered jobs) | ✅                  |
| Use Design Studio & manage floorplans                          | ✅             | ✅              | 🔍 read-only      | ✅ (collaboration)  | ✅                  |
| Offer services / maintain listings                             | ✅             | ✅              | 🔍 read-only      | ✅                  | 🚫                  |
| Respond to RFQs / project invites                              | ✅             | ✅              | 🔍 read-only      | ✅                  | 🚫                  |
| Manage provider teams, staff invites, subcontractors           | ✅             | ✅              | 🔍 read-only      | ✅ (role-specific)  | 🚫                  |
| Access provider analytics & earnings                           | ✅             | ✅              | 🔍 read-only      | ✅                  | 🚫                  |
| Approve/deny provider verification & compliance                | ✅             | ✅              | ✅ (recommend / escalate) | 🚫             | 🚫                  |
| Manage disputes, refunds, chargebacks                          | ✅             | ✅              | ✅ (action limited to refunds/escalations) | 🚫 | 🚫 |
| Configure app settings (fees, categories, feature flags)       | ✅             | ✅              | 🚫                 | 🚫                  | 🚫                  |
| Moderate public content (plan marketplace, reviews, comments)  | ✅             | ✅              | ✅                 | 🚫                  | 🚫                  |
| Access system-level logs / impersonation tools                 | ✅             | 🚫              | 🚫                 | 🚫                  | 🚫                  |

\* All provider subtype roles inherit the `architect.provider` column in the table above.

## Provisioning Checklist

1. **Register roles in Core API**  
   - `POST /v1/apps/architect/roles` with JSON `{ "role": "<role_key>" }` for each role above.  
   - Ensure `roles` table has friendly display names matching the descriptions.
2. **Default assignment rules**  
   - When a user enrolls through `/v1/apps/architect`, grant `architect.homeowner`.  
   - Provider onboarding should grant `architect.provider` plus the chosen subtype (e.g., `architect.contractor`).  
   - Admin/support roles remain manual and audit-logged (requires `platform.admin` or existing `architect.admin`).
3. **Session expectations**  
   - `/v1/auth/verify` returns `platformRoles` and `appRoles`. Architect frontends and services must check these keys when gating routes or endpoints.

## Provider Profile Types

Profile types map user intent to the matching role key. They are shared across backend/ frontend for validation, copy, and analytics.

| Profile Type Key      | Display Label          | Linked Role Key               | Typical Services                                                |
| --------------------- | ---------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `architect`           | Architect / Consultant | `architect.architect`         | Concept design, plan drafting, permit sets, design coordination. |
| `quantity_surveyor`   | Quantity Surveyor      | `architect.quantity_surveyor` | Cost estimation, Bills of Quantities, value engineering.        |
| `land_surveyor`       | Land Surveyor          | `architect.land_surveyor`     | Boundary surveys, GIS data, topographical surveys.              |
| `lawyer`              | Construction Lawyer    | `architect.lawyer`            | Contract drafting/review, regulatory compliance, dispute resolution. |
| `material_supplier`   | Material Supplier      | `architect.material_supplier` | Supply of structural, finishing, and specialty materials.       |
| `contractor`          | Contractor             | `architect.contractor`        | General contracting, specialty trades, construction management. |
| `handyman`            | Handyman / Maintenance | `architect.handyman`          | Minor repairs, maintenance, small projects.                     |
| `interior_designer`   | Interior Designer      | `architect.interior_designer` | Interior concepting, FF&E selection, staging.                   |
| `mover`               | Moving & Logistics     | `architect.mover`             | Relocation, haulage, installation logistics.                     |

Implementation notes:

- Back-end constants live in `architect/service/internal/users/profile_types.go` (with role mapping).
- Front-end constants live in `architect/frontend/src/app/models/profile-types.ts`.
- Validation should always ensure a provider holds both `architect.provider` and exactly one active subtype role; multiple subtypes are allowed when a user offers several services.
- Future specialisations should extend the profile type arrays/maps in both files and update this table.

## Next Steps

- Wire provider onboarding flows (3.3) to leverage the profile type list and assign roles via Core API.
- Extend verification workflows in the Architect admin console to review documentation per profile type.
- Synchronise analytics dashboards to aggregate metrics per profile type and role.
