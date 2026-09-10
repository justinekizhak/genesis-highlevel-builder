# Genesis

AI-powered HighLevel app builder built with Vue 3, TypeScript, shadcn-vue conventions, Monaco, and Firebase.

## Current milestone

Phase 1 implements the end-to-end workspace shell and a mock generation stream:

- Three-panel chat, code editor, and sandboxed preview workspace
- Semantic SSE protocol with file boundaries and completion events
- Local in-browser stream fallback for frontend-only development
- Firebase Functions v2 mock streaming endpoint
- Firestore project ownership rules and server-only HighLevel token boundary

## Local development

```bash
pnpm run install:all
pnpm run dev:frontend
```

The frontend uses a local mock stream when `VITE_FUNCTIONS_BASE_URL` is empty.

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

## Next milestone

Firebase email/password authentication, authenticated project CRUD, HighLevel OAuth, and a server-side HighLevel API gateway.
