# Genesis HTTP API

The canonical machine-readable contract is [`openapi.yaml`](openapi.yaml). It covers the versioned API used by the Vue client, including authentication, validation constraints, error responses, and the SSE generation stream.

## Conventions

- Base URL: `https://jk-ai-app-builder.web.app/api/v1`
- Authentication: `Authorization: Bearer <Firebase ID token>` on every route except health
- Content type: JSON for regular requests and responses; `text/event-stream` for generation
- Versioning: the major version is in the URL. Backward-incompatible changes require `/v2`.
- Ownership: project IDs are always checked against the authenticated Firebase user.
- Errors: regular endpoints return `{ "error": "…" }` with an appropriate 4xx status. Unknown v1 routes use 404; known resources with the wrong method use 405 and `Allow`.
- Idempotency: reads are safe; file replacement uses `PUT`; snapshot metadata uses `PATCH`. Generation and restoration intentionally create new resources and use `POST`.

The older camel-cased function URLs remain available temporarily as compatibility aliases. They are not the public contract and new code should not call them.

## Generation stream

`POST /projects/{projectId}/generations` produces SSE. Events are JSON objects serialized in `data:` lines. The stream begins with `generation_started`, may contain `token`, `file_start`, `file_delta`, `file_complete`, `usage`, and `snapshot_created`, and ends with either `complete` or `error`. Lines beginning with `:` are transport heartbeats.

Clients must treat an EOF without a terminal event as an interrupted generation. The server preserves partial output when possible.

## Try the contract

Import `docs/openapi.yaml` into Swagger Editor, Bruno, Postman, Insomnia, or any OpenAPI 3.1-compatible client. Use a Firebase ID token from a local test account and select the emulator server for local verification.
