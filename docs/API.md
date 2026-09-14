# Genesis HTTP API

The canonical machine-readable contract is [`openapi.yaml`](openapi.yaml). It covers the versioned API used by the Vue client, including authentication, validation constraints, error responses, and the SSE generation stream. The route definitions in `functions/src/http/api-v1.ts` are the implementation source of truth.

## Conventions

- Production base URL: `https://jk-ai-app-builder.web.app/api/v1`
- Emulator base URL: `http://127.0.0.1:5001/jk-ai-app-builder/us-central1/apiV1/v1`
- Authentication: `Authorization: Bearer <Firebase ID token>` on every route except health
- Content type: JSON for regular requests and responses; `text/event-stream` for generation
- Versioning: the major version is in the URL. Backward-incompatible changes require `/v2`.
- Ownership: project IDs are always checked against the authenticated Firebase user.
- Errors: regular endpoints return `{ "error": "…" }` with an appropriate 4xx status. Unknown v1 routes use 404; known resources with the wrong method use 405 and `Allow`.
- Idempotency: reads are safe; file replacement uses `PUT`; snapshot metadata uses `PATCH`. Generation and restoration intentionally create new resources and use `POST`.

The older camel-cased Function URLs remain available temporarily as compatibility aliases. They are not the public contract and new code should not call them.

## Endpoint catalog

Paths below are relative to the production or emulator base URL.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Check API availability without authentication. |
| `POST` | `/projects/{projectId}/generations` | Generate or refine an application and stream SSE events. |
| `POST` | `/projects/{projectId}/generations/{generationId}/cancellation` | Request cancellation of an active generation. |
| `GET` | `/projects/{projectId}/application` | Load current files and recent generation messages. |
| `PUT` | `/projects/{projectId}/files` | Replace editable files and create a manual snapshot. |
| `GET` | `/projects/{projectId}/snapshots` | List the 50 most recent snapshots. |
| `GET` | `/projects/{projectId}/snapshots/{snapshotId}/files` | Load the immutable files in one snapshot. |
| `PATCH` | `/projects/{projectId}/snapshots/{snapshotId}` | Update a snapshot's `message` or `description`. |
| `POST` | `/projects/{projectId}/snapshots/{snapshotId}/restorations` | Restore a snapshot after preserving the current state. |
| `GET` | `/integrations/status` | Load AI configuration and HighLevel readiness. |
| `GET` | `/integrations/highlevel/connection` | Load the current HighLevel connection summary. |
| `POST` | `/integrations/highlevel/authorizations` | Create a short-lived HighLevel OAuth authorization request. |
| `POST` | `/integrations/highlevel/proxy-requests` | Execute one allowlisted HighLevel operation. |

HighLevel calls two separate inbound endpoints that are not part of the authenticated v1 browser API:

- OAuth redirect: `https://jk-ai-app-builder.web.app/api/hlAuthCallback`
- Webhook receiver: the deployed `hlWebhook` Function URL

## Generation stream

`POST /projects/{projectId}/generations` produces SSE. Events are JSON objects serialized in `data:` lines. The stream begins with `generation_started`, may contain `token`, `file_start`, `file_delta`, `file_complete`, `usage`, and `snapshot_created`, and ends with either `complete` or `error`. Lines beginning with `:` are transport heartbeats.

Firebase Hosting buffers rewritten streaming responses. In production, the client therefore sends only this request directly to `https://us-central1-jk-ai-app-builder.cloudfunctions.net/apiV1/v1/projects/{projectId}/generations`; all non-streaming v1 requests continue through the Hosting base URL above. Authentication and routing behavior are identical.

Clients must treat an EOF without a terminal event as an interrupted generation. The server preserves partial output when possible.

## Try the contract

Import `docs/openapi.yaml` into Swagger Editor, Bruno, Postman, Insomnia, or any OpenAPI 3.1-compatible client. Use a Firebase ID token from a local test account and select the emulator server for local verification. A production health check is simply `GET https://jk-ai-app-builder.web.app/api/v1/health`.
