# Core API Integration Reference

The architect service integrates with `api.berjis.tech` for auth, user management, billing, and support. This document summarizes the relevant endpoints from `api/openapi/berjis-api.v1.yaml` so backend and frontend teams can wire calls without re-opening the full specification.

## Authentication

| Method | Path | Summary | Notes |
| --- | --- | --- | --- |
| POST | `/v1/auth/login` | Login with email/password | Send `LoginRequest` (`email`, `password`). On success, access/refresh cookies are issued and an `ApiResponse` envelope is returned. |
| POST | `/v1/auth/refresh` | Rotate refresh session and issue new access token | Requires refresh cookie; returns updated tokens in cookies plus standard `ApiResponse`. |
| POST | `/v1/auth/verify` | Validate current session and return metadata | Requires bearer or cookie auth. Response is `VerifyEnvelope` with active session details and role scopes. Use to confirm tokens when JWKS cache misses. |
| POST | `/v1/auth/logout` | Clear refresh/access cookies | Invalidates current session. Response is basic `ApiResponse`. |

## User Management

| Method | Path | Summary | Key Payload / Response Details |
| --- | --- | --- | --- |
| POST | `/v1/users` | Create new user account | Accepts `SignupRequest` (email, password, name). Returns `ApiResponse`; handles 400 (validation) and 409 (email exists). |
| GET | `/v1/me` | Fetch current user profile | Auth required. Returns `{ success, data: MeProfile }`. |
| PUT | `/v1/me` | Update basic profile fields | Accepts JSON with optional `name` and `password`. |
| PUT | `/v1/me/profile` | Update extended profile details | Accepts `ProfileUpdateRequest` (addresses, socials, etc.). Returns updated `MeProfile`. |
| POST | `/v1/me/avatar` | Upload/replace avatar | Multipart form with `file` (binary). Returns `AvatarUploadResponse`. |
| PUT | `/v1/me/moderation/filters` | Set filtered word list | Accepts `FilteredWordsRequest`; returns `FilteredWordsResponse`. |
| POST | `/v1/me/blocks` | Block a user by UUID | Payload `BlockUserRequest` containing `target_user_id`. Returns updated `BlockListResponse`. |
| DELETE | `/v1/me/blocks/{id}` | Unblock a user | Path `{id}` is target UUID. Returns updated `BlockListResponse`. |
| POST | `/v1/reports` | Report a user/content issue | Accepts `ReportUserRequest` (target, reason, context). |
| GET | `/v1/users/search` | Search users directory | Query params `q` (min 2 chars) and optional `limit` (1–50). Returns array of `UserSearchResult`. |

### Notes
- Every endpoint except `POST /v1/users` requires either bearer token or session cookies provided by `/v1/auth/login`.
- Avatar uploads respect platform file size/type rules enforced centrally by the API.
- Moderation/blocks/report endpoints help downstream apps stay aligned with platform-wide safety controls.

## Billing

| Method | Path | Summary | Key Details |
| --- | --- | --- | --- |
| POST | `/v1/billing/payment-intents` | Create payment intent | Body requires `amount_cents`; optional `currency`, `description`, `provider`. Returns intent envelope. |
| GET | `/v1/billing/payment-intents/{id}` | Retrieve single payment intent | Path `{id}` integer. Returns intent status or 404. |
| POST | `/v1/billing/webhooks/mpesa` | Receive M-Pesa callbacks | Raw JSON webhook payload; forwards to billing processor. |
| POST | `/v1/billing/webhooks/stripe` | Receive Stripe callbacks | Expects Stripe event payload; used for signature verification upstream. |
| POST | `/v1/billing/webhooks/flutterwave` | Receive Flutterwave callbacks | Same structure as provider payload. |
| GET | `/v1/billing/subscriptions` | List current user subscriptions | Returns `{ success, data: []Subscription }`. |
| POST | `/v1/billing/subscriptions` | Create subscription record | Body requires `product_key`; optional `status`, `current_period_end`. |
| PATCH | `/v1/billing/subscriptions/{id}/cancel` | Cancel subscription | Marks plan as canceled; takes subscription ID (integer). |

### Integration Tips
- Always attach bearer token or session cookie; billing endpoints are user-specific.
- Provider webhook routes must be exposed publicly and protected by provider-side secrets (Stripe signature headers, etc.).
- Subscription records are the source of truth for entitlement checks inside the architect service.

## Support

| Method | Path | Summary | Notes |
| --- | --- | --- | --- |
| GET | `/v1/support/tickets` | List current user's support tickets | Returns standard `ApiResponse` with ticket list. |
| POST | `/v1/support/tickets` | Create new support ticket | Body requires `subject`, `body`. Returns `ApiResponse` success flag. |

### Support Workflow
- Tickets are owned by the platform support team; architect should link users here rather than re-implement ticketing.
- After creating a ticket, the `/v1/notifications` feed in the Core API will surface updates.

## Frontend Consumption Notes

- Angular clients should import `CoreAuthService` from `@berjis/angular-auth` and call `ensureAuth()` on gated routes.
- HTTP calls to the architect backend use `fetch(..., { credentials: 'include' })`, so session cookies issued by `/v1/auth/login` automatically flow without additional headers.
- If additional interceptors are required, use the shared provider from `clients/angular-auth` rather than rolling custom logic, keeping auth behavior identical across apps.
