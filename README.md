# Genesis

AI-powered HighLevel app builder built with Vue 3, TypeScript, shadcn-vue conventions, Monaco, and Firebase.

## Current milestone

The current implementation includes the workspace, authentication boundary, project persistence, AI generation, and HighLevel connection layer:

- Three-panel chat, code editor, and sandboxed preview workspace
- Semantic SSE protocol with file boundaries and completion events
- Local in-browser generation fallback for frontend-only development
- Authenticated Firebase Functions generation endpoint using the OpenAI Responses API
- Strict structured-output validation for `index.html`, `styles.css`, and `app.js`
- Versioned Firestore snapshots and persisted user/assistant messages
- Last-good-file restoration when generation is cancelled or fails
- Firestore project ownership rules and server-only HighLevel token boundary
- Firebase email/password sign-in and sign-up with session restoration
- Persistent owner-scoped project creation and soft-delete support
- HighLevel OAuth state validation, server-only token storage, and refresh leasing
- An allowlisted HighLevel gateway for Contacts, Conversations, and Calendars
- A sandbox-to-parent RPC bridge so generated apps can read HighLevel data without receiving credentials
- Runtime connection status for both HighLevel and the configured OpenAI model

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

The emulator command restores data from `.firebase/emulator-data` when an export exists and writes Auth and Firestore data back there during a clean shutdown. Use `Ctrl+C` once and wait for the export to finish. The directory is intentionally gitignored because it can contain local users, OAuth tokens, and generated project data.

Set `VITE_FUNCTIONS_BASE_URL=http://127.0.0.1:5001/jk-ai-app-builder/us-central1` in `frontend/.env.local` and always open the frontend at `http://127.0.0.1:5173` so Firebase Auth remains on the same origin throughout OAuth.

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

The generated iframe cannot call HighLevel directly. It can request only these read-only bridge operations:

- `contacts.list`
- `conversations.list`
- `conversations.messages`
- `calendars.list`
- `appointments.list`

Every request is source-checked in the browser, authenticated with Firebase, allowlisted in the Function, and executed with the server-side HighLevel token.

## OpenAI configuration

The API key is read only by the generation function and is never sent to the Vue application or generated preview:

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

`OPENAI_MODEL` defaults to `gpt-5.4-mini` and can be overridden in the Firebase environment. During local emulator development, an absent secret falls back to the deterministic demo generator. Set the secret before deploying the generation function.

Copy `functions/.env.example` to the Firebase project-specific environment file and fill in the non-secret values. Do not put either API secret in a dotenv file.

## CI/CD

`.github/workflows/firebase-deploy.yml` builds and tests every pull request targeting `main`. A push to `main`, or a manual workflow dispatch, deploys Firebase Hosting, Functions, Firestore rules, and indexes to `jk-ai-app-builder`.

The deployment uses Google Cloud Workload Identity Federation instead of a long-lived Firebase token or service-account key. After adding a GitHub remote, create a GitHub environment named `production` with:

- Repository/environment variables: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`
- Environment secrets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`

Restrict the Workload Identity provider to the exact GitHub repository and `main` branch, and grant its deployment service account only the permissions needed for Firebase Hosting, Cloud Functions, Firestore rules/indexes, Cloud Build, Artifact Registry, and service-account use. The runtime values for `OPENAI_API_KEY` and `HL_CLIENT_SECRET` remain in Google Secret Manager and are not copied into GitHub.

The non-secret production Functions parameters are stored in `functions/.env.jk-ai-app-builder`. Local overrides and secrets remain gitignored.

## Next milestone

Add snapshot history/restore controls, then connect the generated-app bridge to the allowlisted HighLevel gateway.
