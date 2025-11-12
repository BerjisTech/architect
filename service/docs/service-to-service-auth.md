# Service-to-Service Auth Configuration

The architect service makes privileged calls to the Berjis Core API (api.berjis.tech). These requests must carry a service-scoped bearer token issued by the Core platform. This document covers how the service loads and uses that token without duplicating auth logic.

## Environment Variables

| Variable | Description |
| --- | --- |
| `CORE_API_SERVICE_TOKEN` | Inline bearer token for service-to-service requests. Preferred for container orchestrators that support secret injection as env vars. |
| `CORE_API_SERVICE_TOKEN_FILE` | Optional file path containing the token. Use this when secrets are mounted as files (e.g., Kubernetes Secrets, Docker secrets). |

Both values are optional, but at least one should be provided in production. When both are set, the inline token takes precedence.

Sample `.env` snippet:

```
CORE_API_SERVICE_TOKEN=service-token-here
# or
CORE_API_SERVICE_TOKEN_FILE=/run/secrets/core_api_token
```

## Runtime Loading

`cmd/service/main.go` calls `secrets.ServiceToken`, which:

1. Uses the trimmed `CORE_API_SERVICE_TOKEN` when present.
2. Otherwise reads `CORE_API_SERVICE_TOKEN_FILE` and trims the contents.
3. Emits a warning if the file is missing or unreadable.

The resolved token initializes `internal/coreapi.Client` with a static bearer header, ensuring all downstream requests reuse the shared auth implementation in `./api`.

## Rotation & Management

- Rotate tokens centrally in the Core API admin tools, then update the secret in your deployment environment.
- When leveraging file-based secrets, update the mounted file and restart or signal the process so it reloads the secret.
- Never commit tokens to source control; rely on orchestrator secret stores.

## Failure Modes

- Missing token: the service logs a warning and skips Core API client initialization. Handlers that need Core API access should check for a nil client and return a 503.
- Invalid token: the Core API will respond with 401/403 errors, surfaced as `coreapi.APIError`. Monitor logs for these to detect drift.
