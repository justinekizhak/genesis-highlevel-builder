# Genesis

AI-powered HighLevel app builder built with Vue 3, TypeScript, repo-owned shadcn-vue components, Monaco, and Firebase.

## Current milestone

The current implementation includes the workspace, authentication boundary, project persistence, AI generation, and HighLevel connection layer:

- Three-panel chat, code editor, and sandboxed preview workspace
- Upstream OpenAI Responses streaming translated into semantic SSE file events
- Local in-browser generation fallback for frontend-only development
- Authenticated Firebase Functions generation endpoint using the OpenAI Responses API
- Strict structured-output validation for `index.html`, `styles.css`, and `app.js`
- Versioned Firestore snapshots, history, restore, and persisted user/assistant messages
- Partial-generation preservation plus a recoverable backup before every restore
- Debounced persistence for manual Monaco edits
- TanStack Query caching and invalidation for project, integration, snapshot, and project-state requests
- Route-level code splitting plus a dynamically imported Monaco editor
- Latest-generation line diff viewer with added and removed line counts
- Reduced-motion-aware Anime.js entrance and interaction feedback
- Firestore project ownership rules and server-only HighLevel token boundary
- Firebase email/password sign-in and sign-up with session restoration
- Visible owner-scoped project create, read, edit, and soft-delete flows
- HighLevel OAuth state validation, location-name lookup, server-only token storage, and refresh leasing
- An allowlisted HighLevel gateway for Contacts, Conversations, and Calendars
- A sandbox-to-parent RPC bridge so generated apps can read and explicitly confirmed write HighLevel data without receiving credentials
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

## Live URLs

- Firebase Hosting: https://jk-ai-app-builder.web.app
- Cloud Functions base URL: https://us-central1-jk-ai-app-builder.cloudfunctions.net
- OAuth callback: https://us-central1-jk-ai-app-builder.cloudfunctions.net/hlAuthCallback

After deployment, verify the Hosting URL and the `/healthz` Function before recording the demo.

## HighLevel OAuth configuration

Set the non-secret parameters in the Firebase environment and bind the client secret:

```bash
firebase functions:secrets:set HL_CLIENT_SECRET
```

Required values are documented in `.env.example`. Register the deployed `hlAuthCallback` function URL as the marketplace app redirect URI.

The generated iframe cannot call HighLevel directly. It can request only these allowlisted bridge operations:

- `contacts.list`
- `contacts.create` (confirmation required)
- `contacts.update` (confirmation required)
- `conversations.list`
- `conversations.messages`
- `conversations.send` (confirmation required)
- `calendars.list`
- `calendars.availability`
- `appointments.list`

Every request is source-checked in the browser, authenticated with Firebase, allowlisted in the Function, and executed with the server-side HighLevel token. Write requests pause in a shadcn-vue alert dialog until the user confirms them.

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

### One-time GitHub setup

The workflow is ready to verify pull requests and deploy every push to `main`, but it needs a public GitHub repository and two repository/environment variables plus two secrets. Create a GitHub environment named `production`, then configure:

- Variables: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`
- Secrets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`

The Google service account must be allowed to deploy Firebase Hosting, Cloud Functions, Firestore rules/indexes, Cloud Build artifacts, and impersonate the runtime service account. Restrict the Workload Identity provider to this exact repository and the `main` branch.

At the time of the latest audit, the local Firebase CLI is authenticated and the Firebase project, web app, Hosting site, `OPENAI_API_KEY`, and `HL_CLIENT_SECRET` all exist. Hosting and Function URLs still return 404, so the first production deployment has not completed. The local GitHub CLI account is present but its token is invalid; run `gh auth login -h github.com` before creating and pushing the public repository.

## Architecture decisions

- The browser authenticates streaming POST requests with Firebase ID tokens using `fetch`; native `EventSource` cannot send the required authorization header and request body.
- OpenAI structured-output deltas are parsed server-side into `token`, `file_start`, `file_delta`, `file_complete`, snapshot, completion, and error events.
- Only three fixed preview files are accepted, which keeps validation, storage, and sandbox execution bounded.
- Current editable files are stored separately from immutable generation snapshots.
- Snapshot restore creates a backup first, so restoring never discards the current manual state irreversibly.
- Generated applications run in a CSP-restricted iframe with no direct network access.
- HighLevel access crosses an allowlisted `postMessage` bridge and authenticated server proxy; OAuth credentials never reach generated code.
- HighLevel refresh tokens are rotated behind a short Firestore lease to prevent concurrent refresh races.
- Failed or cancelled generations keep visible partial output and persist a partial snapshot when possible.
- Local mock mode mirrors streaming and snapshot behavior so the core workflow can be demonstrated without secrets.

## What I would improve

- Add emulator-backed integration tests for authenticated SSE, snapshots, OAuth, and Firestore rules.
- Persist snapshot-to-snapshot diffs and move very large comparisons into a Web Worker.
- Add per-user rate limits and usage telemetry around generation and proxy endpoints.
- Add end-to-end sandbox fixtures for confirmed HighLevel writes and calendar availability.
- Move Firebase Auth initialization behind a smaller bootstrap boundary to reduce the remaining initial vendor chunk.

## Deployment notes

Create the Firebase project, enable Email/Password Authentication and Firestore, bind `OPENAI_API_KEY` and `HL_CLIENT_SECRET` in Secret Manager, populate the documented non-secret parameters, then deploy Hosting, Functions, rules, and indexes. Register the deployed `hlAuthCallback` URL in the HighLevel marketplace app and authorize the Firebase Hosting domain in Firebase Authentication.

The included GitHub Actions workflow uses Workload Identity Federation and deploys pushes to `main` after the build and test job passes. A manual `pnpm run deploy` is also available for a configured Firebase CLI session.

## Submission checklist

- Add the public GitHub repository URL.
- Deploy and verify the URLs above.
- Record the five-minute Loom walkthrough and add its URL here and to the submission email.
