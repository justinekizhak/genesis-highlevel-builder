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
| `GET` | `/projects/{projectId}/variation-sets/{variationSetId}` | Load a variation set and its two persisted finalists. |
| `POST` | `/projects/{projectId}/variation-sets/{variationSetId}/selection` | Promote one finalist to the project's active files. |
| `GET` | `/integrations/status` | Load AI configuration and HighLevel readiness. |
| `GET` | `/integrations/highlevel/connection` | Load the current HighLevel connection summary. |
| `POST` | `/integrations/highlevel/authorizations` | Create a short-lived HighLevel OAuth authorization request. |
| `POST` | `/integrations/highlevel/proxy-requests` | Execute one allowlisted HighLevel operation. |

HighLevel calls two separate inbound endpoints that are not part of the authenticated v1 browser API:

- OAuth redirect: `https://jk-ai-app-builder.web.app/api/hlAuthCallback`
- Webhook receiver: the deployed `hlWebhook` Function URL

## Generation stream

`POST /projects/{projectId}/generations` produces SSE. Events are JSON objects serialized in `data:` lines.

| Event | Purpose |
|---|---|
| `generation_started` | Identifies the generation and model. |
| `token` | Streams the assistant summary. |
| `file_start` | Announces the file path and editor language. |
| `file_delta` | Appends source text for the active file. |
| `file_complete` | Supplies final size and SHA-256 digest. |
| `usage` | Reports token usage for the call. |
| `snapshot_created` | Identifies the persisted point-in-time snapshot. |
| `complete` | Closes a successful generation. |
| `error` | Returns a code, user-facing message, and recovery status. |

Lines beginning with `:` are comment-only transport heartbeats and never become application events.

Firebase Hosting buffers rewritten streaming responses. In production, the client therefore sends only this request directly to `https://us-central1-jk-ai-app-builder.cloudfunctions.net/apiV1/v1/projects/{projectId}/generations`; all non-streaming v1 requests continue through the Hosting base URL above. Authentication and routing behavior are identical.

Clients must treat an EOF without a terminal event as an interrupted generation. The server preserves partial output when possible.

## Multiple UI variations

A planning call classifies every request before generation begins. An ordinary request keeps the single stream above unchanged. A request that asks for alternatives — "create multiple variations", "show me a few directions", "give me different versions" — enters the variation branch, which is OpenAI-only.

The variation branch generates exactly four candidates fully in parallel (concurrency equal to the candidate count), qualifies and grades them while their code stays in function memory, persists exactly the top two, and streams only those two file sets. Discarded candidate code is never persisted and never reaches the client.

### Variant-aware stream events

`variation_planning_started` is emitted on every request, before classification. A variation batch then emits:

| Event | Payload |
|---|---|
| `variation_set_started` | `variationSetId`, `count` (always 4) |
| `candidate_started` | `candidateId`, `index` |
| `candidate_progress` | `candidateId`, `phase` (`summary` \| `markup` \| `styles` \| `logic`) |
| `candidate_complete` | `candidateId` |
| `candidate_failed` | `candidateId`, `recoverable` |
| `variation_validation_started` | `completedCount` |
| `variation_validation_complete` | `eligibleCount` |
| `variation_grading_started` | `eligibleCount` |
| `variation_grading_complete` | `gradingMode` (`full` \| `deterministic_fallback`) |
| `finalist_metadata` | `variationSetId`, two finalists with `candidateId`, `displayName`, `summary`, `strengths`, `risks` |
| `finalist_file_start` | `candidateId`, `path`, `language` |
| `finalist_file_delta` | `candidateId`, `path`, `delta` |
| `finalist_file_complete` | `candidateId`, `path`, `size`, `sha256` |
| `finalists_ready` | `variationSetId` |
| `variation_complete` | `variationSetId` — terminal; a variation batch never emits `complete` |

Candidate progress is derived from real structured-stream milestones, never from elapsed time. `finalist_metadata` is emitted only after both finalists are persisted, so an interrupted transfer can be recovered with `GET /projects/{projectId}/variation-sets/{variationSetId}`.

### Selection

`POST /projects/{projectId}/variation-sets/{variationSetId}/selection` takes `{ "candidateId": "…" }` and returns `{ "snapshotId": "…", "files": { … } }`. No active project file changes until this call succeeds.

The first selection requires the project's `latestSnapshotId` to still equal the set's `baseSnapshotId`; a mismatch returns **409** so a stale tab cannot overwrite newer work. Selecting the already-active candidate is idempotent and returns its existing snapshot. A later switch to the other finalist preserves the immutable `initialSelectedCandidateId`, creates a backup snapshot of the current active files, and returns **409** while another generation lock is active.

The promoted snapshot records `variationSetId` and `variationCandidateId`; ordinary snapshots omit both, and snapshot history uses them to reopen the comparison.

### Errors and quotas

- `VARIATION_INSUFFICIENT_CANDIDATES` — fewer than two candidates qualified. No variation set is persisted and the active project is unchanged.
- A variation batch charges **four** generation quota units; a single request charges **one**. The charge is atomic, so two simultaneous requests cannot straddle the minute or daily limit.
- Variation sets and finalist documents are owner-read and server-write only: `projects/{projectId}/variationSets/{variationSetId}` and its `candidates` subcollection reject all client writes.

## Try the contract

Import `docs/openapi.yaml` into Swagger Editor, Bruno, Postman, Insomnia, or any OpenAPI 3.1-compatible client. Use a Firebase ID token from a local test account and select the emulator server for local verification. A production health check is simply `GET https://jk-ai-app-builder.web.app/api/v1/health`.
