# Genesis

AI-powered HighLevel app builder built with Vue 3, TypeScript, shadcn-vue conventions, Monaco, and Firebase.

## Current milestone

The current implementation includes the workspace, authentication boundary, projects, and HighLevel connection layer:

- Three-panel chat, code editor, and sandboxed preview workspace
- Semantic SSE protocol with file boundaries and completion events
- Local in-browser stream fallback for frontend-only development
- Firebase Functions v2 mock streaming endpoint
- Firestore project ownership rules and server-only HighLevel token boundary
- Firebase email/password sign-in and sign-up with session restoration
- Persistent owner-scoped project creation and soft-delete support
- HighLevel OAuth state validation, server-only token storage, and refresh leasing
- An allowlisted HighLevel gateway for Contacts, Conversations, and Calendars

## Local development

```bash
pnpm run install:all
pnpm run dev:frontend
```

The frontend uses a local mock stream when `VITE_FUNCTIONS_BASE_URL` is empty.
It also exposes a local demo login and stores demo projects in the browser when Firebase is not configured.

To run against Firebase emulators:

```bash
pnpm run dev:emulators
```

Then set `VITE_FUNCTIONS_BASE_URL=http://127.0.0.1:5001/demo-genesis/us-central1` in `frontend/.env.local`.

## Verification

```bash
pnpm run build
pnpm run test
```

## HighLevel OAuth configuration

Set the non-secret parameters in the Firebase environment and bind the client secret:

```bash
firebase functions:secrets:set HL_CLIENT_SECRET
```

Required values are documented in `.env.example`. Register the deployed `hlAuthCallback` function URL as the marketplace app redirect URI.

## Next milestone

Replace the mock generator with an authenticated LLM stream, validate file operations, and persist messages, staged files, and snapshots.
