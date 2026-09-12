# Genesis

AI-powered HighLevel app builder built with Vue 3, TypeScript, repo-owned shadcn-vue components, Monaco, and Firebase.

Describe an app in plain English, connect a real HighLevel location, and Genesis streams a working Vue mini-app —
token by token — into a Monaco editor. The live preview runs that app in a hard-sandboxed iframe against **your real
HighLevel CRM data** (Contacts, Conversations, Calendars): no demo mode, no canned data, no fallback dashboard. If
HighLevel isn't connected, Genesis won't generate — that's enforced both in the UI and on the server.

## Reviewing this submission? Start here

| Requirement | Where | Proof in 30 seconds |
|---|---|---|
| Email/password auth + session persistence | [`views/AuthView.vue`](frontend/src/views/AuthView.vue), [`stores/auth.ts`](frontend/src/stores/auth.ts) | Sign in, refresh the page |
| HighLevel OAuth + token storage/refresh | [`highlevel/tokens.ts`](functions/src/highlevel/tokens.ts), [`index.ts`](functions/src/index.ts) (`hlOAuthStart`/`hlAuthCallback`) | Dashboard → Connect HighLevel |
| Project CRUD, owner-scoped rules | [`stores/projects.ts`](frontend/src/stores/projects.ts), [`firestore.rules`](firestore.rules) | Create/rename/delete a project on the dashboard |
| SSE streaming + event protocol | [`index.ts`](functions/src/index.ts) (`generateApp`), [`shared/protocol.ts`](functions/src/shared/protocol.ts) | Send a prompt, watch tokens land live in Monaco |
| Real HighLevel data only, connection mandatory | [`generate/openai.ts`](functions/src/generate/openai.ts) (system prompt), [`index.ts`](functions/src/index.ts) `generateApp` | Generation is blocked server-side until `project.locationId` is set |
| Monaco editor, tabs, read-only while streaming | [`components/workspace/WorkspaceShell.vue`](frontend/src/components/workspace/WorkspaceShell.vue) | Send any prompt, watch the editor |
| Live preview, sandboxed iframe | [`lib/srcdoc.ts`](frontend/src/lib/srcdoc.ts) | Generated dashboard lists your sandbox contacts |
| Snapshots on generation **and** manual edits + restore | [`generate/persistence.ts`](functions/src/generate/persistence.ts), snapshot sheet in `WorkspaceShell.vue` | Edit a file → History icon → see a "Manual edit" entry → Restore |
| Rate limiting | [`http/rate-limit.ts`](functions/src/http/rate-limit.ts) | 5 generations/min, 50/day, 60 HL-proxy calls/min per user |
| Bonuses implemented | see below | Stop button, refinement prompts, "View changes" diff, rate limiting |

## What it does

1. **Sign up / sign in** (Firebase Auth, email + password).
2. **Connect HighLevel** — OAuth 2.0 (authorize → Cloud Function callback → tokens in a server-only Firestore collection). One location per user.
3. **Create a project** and describe what you want in chat. The chat composer stays disabled until HighLevel is connected.
4. **Watch generation stream** — the Cloud Function streams OpenAI over SSE, parses file boundaries server-side, types code into Monaco live, and persists each file as it completes.
5. **Live preview with real CRM data** — generated apps run in a sandboxed iframe and call Contacts/Conversations/Calendars through an injected `window.genesis.highlevel` bridge → `postMessage` → the `hlProxy` Cloud Function → HighLevel. The model is instructed to never fabricate data; a failed call shows an error state, not a placeholder.
6. **Iterate** — follow-up prompts revise the existing files rather than starting over.
7. **Snapshots** — every generation *and* every manual edit appends a restorable point-in-time snapshot.

### Bonus features implemented
- Generation **cancellation** (Stop button aborts the model stream mid-flight; completed files are kept)
- **Iterative refinement** (the model receives current files and recent chat history, and revises rather than discards)
- **Diff view** per generation (line-level added/removed counts against the pre-generation files)
- **Rate limiting** — per-user Firestore fixed-window counters: 5 generations/min, 50/day, 60 HighLevel-proxy calls/min, all returning a clear 429 message

### Bonus features not implemented (see "What I would improve")
- Generated-app pagination patterns for HighLevel list endpoints
- HighLevel webhook support

## Local development

```bash
pnpm run install:all
pnpm run dev:frontend
```

Local development always talks to Firebase — there is no offline/demo mode. Configure `frontend/.env.local` with your
Firebase project's `VITE_FIREBASE_*` values and `VITE_FUNCTIONS_BASE_URL`, and run against emulators:

```bash
pnpm run dev:emulators
```

The emulator command restores data from `.firebase/emulator-data` when an export exists and writes Auth and Firestore
data back there during a clean shutdown. Use `Ctrl+C` once and wait for the export to finish. The directory is
intentionally gitignored because it can contain local users, OAuth tokens, and generated project data.

Set `VITE_FUNCTIONS_BASE_URL=http://127.0.0.1:5001/jk-ai-app-builder/us-central1` in `frontend/.env.local` and always
open the frontend at `http://127.0.0.1:5173` so Firebase Auth remains on the same origin throughout OAuth.

## Verification

```bash
pnpm run build
pnpm run test
```

## Live URLs

- Public repository: https://github.com/justinekizhak/genesis-highlevel-builder
- Firebase Hosting: https://jk-ai-app-builder.web.app
- Cloud Functions base URL: https://jk-ai-app-builder.web.app/api
- OAuth callback: https://jk-ai-app-builder.web.app/api/hlAuthCallback
- Loom walkthrough: _add link before submitting_

## HighLevel OAuth configuration

1. Create a HighLevel developer account and a location-level marketplace app. Obtain its Client ID and Client Secret.
2. Enable these scopes in the marketplace app:

   ```text
   contacts.readonly contacts.write conversations.readonly
   conversations/message.readonly conversations/message.write
   calendars.readonly calendars/events.readonly locations.readonly
   ```

3. From the developer dashboard, create a sandbox/test sub-account and add at least one calendar so the generated appointment views have a valid calendar ID.
4. Copy `functions/.env.example` to the Firebase project-specific environment file and set `HL_CLIENT_ID`, `HL_REDIRECT_URI`, `HL_API_BASE`, `APP_ORIGINS`, and `APP_BASE_URL`.
5. Store the client secret in Firebase Secret Manager:

   ```bash
   firebase functions:secrets:set HL_CLIENT_SECRET
   ```

6. Register the deployed `hlAuthCallback` Function URL as the marketplace app redirect URI. If scopes change after a location was connected, reinstall/re-authorize the app in the sandbox so the new grant is reflected in its tokens.

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

Every request is source-checked in the browser, authenticated with Firebase, allowlisted in the Function, rate-limited,
and executed with the server-side HighLevel token. Write requests pause in a shadcn-vue alert dialog until the user
confirms them.

## OpenAI configuration

The API key is read only by the generation function and is never sent to the Vue application or generated preview:

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

`OPENAI_MODEL` defaults to `gpt-5.4-mini` and can be overridden in the Firebase environment. If the secret isn't set,
or OpenAI returns an out-of-quota error, `generateApp` fails with a clear, user-facing message instead of silently
substituting placeholder content — Genesis never fabricates data to paper over a misconfigured or exhausted account.

Copy `functions/.env.example` to the Firebase project-specific environment file and fill in the non-secret values. Do not put either API secret in a dotenv file.

## CI/CD

`.github/workflows/firebase-deploy.yml` builds and tests every pull request targeting `main`. A push to `main`, or a manual workflow dispatch, deploys Firebase Hosting, Functions, Firestore rules, and indexes to `jk-ai-app-builder`.

The deployment uses Google Cloud Workload Identity Federation instead of a long-lived Firebase token or service-account key. After adding a GitHub remote, create a GitHub environment named `production` with:

- Repository/environment variables: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`
- Environment secrets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`

Restrict the Workload Identity provider to the exact GitHub repository and `main` branch, and grant its deployment service account only the permissions needed for Firebase Hosting, Cloud Functions, Firestore rules/indexes, Cloud Build, Artifact Registry, and service-account use. The runtime values for `OPENAI_API_KEY` and `HL_CLIENT_SECRET` remain in Google Secret Manager and are not copied into GitHub.

The non-secret production Functions parameters are stored in `functions/.env.jk-ai-app-builder`. Local overrides and secrets remain gitignored.

## Architecture decisions

- The browser authenticates streaming POST requests with Firebase ID tokens using `fetch`; native `EventSource` cannot send the required authorization header and request body.
- OpenAI structured-output deltas are parsed server-side into `token`, `file_start`, `file_delta`, `file_complete`, snapshot, completion, and error events.
- Generation reloads three fixed project files and a bounded recent conversation from Firestore instead of trusting source code supplied by the browser; the fixed set keeps validation, storage, and sandbox execution bounded.
- Generation is refused server-side unless the project has a connected HighLevel `locationId` — the "real data only" requirement is enforced at the API boundary, not just hidden behind a UI gate.
- Current editable files are stored separately from server-write-only generation snapshots.
- Every manual file save also appends a restorable snapshot, alongside snapshots from generations and pre-restore backups, so nothing edited by hand is ever unrecoverable.
- Generated applications run in a CSP-restricted iframe with no direct network access; HighLevel access crosses an allowlisted `postMessage` bridge and authenticated server proxy, so OAuth credentials never reach generated code. The system prompt instructs the model to call that bridge immediately and never fabricate placeholder CRM data.
- HighLevel refresh tokens are rotated behind a short Firestore lease to prevent concurrent refresh races.
- Rate limiting uses per-user Firestore fixed-window counters rather than an in-memory store, since Cloud Functions instances are ephemeral and don't share memory across invocations.
- Failed or cancelled generations keep visible partial output and persist a partial snapshot when possible.

## What I would improve

- Add emulator-backed integration tests for authenticated SSE, snapshots, OAuth, and Firestore rules.
- Add HighLevel webhook support (e.g., a new contact created) and generated-app pagination patterns for HighLevel list endpoints — both bonus items, currently unimplemented.
- Persist snapshot-to-snapshot diffs and move very large comparisons into a Web Worker.
- Configure a Firestore TTL policy on `rateLimits.expiresAt` so old rate-limit windows are purged automatically instead of accumulating.
- Add end-to-end sandbox fixtures for confirmed HighLevel writes and calendar availability.

## Deployment notes

Create the Firebase project, enable Email/Password Authentication and Firestore, bind `OPENAI_API_KEY` and `HL_CLIENT_SECRET` in Secret Manager, populate the documented non-secret parameters, then deploy Hosting, Functions, rules, and indexes. Register the deployed `hlAuthCallback` URL in the HighLevel marketplace app and authorize the Firebase Hosting domain in Firebase Authentication.

The included GitHub Actions workflow uses Workload Identity Federation and deploys pushes to `main` after the build and test job passes. A manual `pnpm run deploy` is also available for a configured Firebase CLI session.
