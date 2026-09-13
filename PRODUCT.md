# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and technical agency operators building internal or client-facing tools on top of HighLevel (the CRM/marketing platform). They know what HighLevel data (Contacts, Conversations, Calendars) looks like and want a working mini-app scaffolded from a plain-English description instead of hand-building a Vue app against the HighLevel API themselves.

## Product Purpose

Genesis turns a plain-English description into a working Vue mini-app, streamed token-by-token into a live-editable Monaco editor, and previewed in a sandboxed iframe running against the user's own connected HighLevel location. Success is a real, working, iteratively-refinable app wired to a specific HighLevel account — not a mockup or a demo.

## Positioning

Generation is refused server-side unless the project has a connected HighLevel `locationId` — a competing "AI app builder" that falls back to demo or placeholder data when a data source isn't connected could not make this claim truthfully. Generated apps only ever read and write real Contacts/Conversations/Calendars through an allowlisted bridge; the model is explicitly instructed to never fabricate CRM data, and a failed API call surfaces as an error state rather than a placeholder.

## Operating Context

- Sign in (Firebase email/password) → connect a HighLevel location via OAuth → create a project → describe the desired app in chat.
- Generation streams over SSE into Monaco; the editor is read-only while a generation is in flight.
- The generated app runs live in a CSP-restricted sandboxed iframe with no direct network access; all HighLevel calls cross an injected `window.genesis.highlevel` bridge → `postMessage` → an authenticated, rate-limited Cloud Function proxy. Write operations (create/update contact, send message) execute immediately after an explicit action in the generated app.
- Every generation and every manual file edit appends a restorable snapshot; a history/restore UI surfaces these.
- Follow-up prompts revise existing files iteratively rather than regenerating from scratch, with a diff view against the pre-generation state.
- Rate limits apply per user: 5 generations/min, 50/day, 60 HighLevel-proxy calls/min.

## Capabilities and Constraints

- Stack: Vue 3 + TypeScript frontend, shadcn-vue (official CLI, on reka-ui) components, Monaco editor, Firebase (Auth, Firestore, Functions, Hosting), OpenAI for generation.
- One HighLevel location connected per user.
- Allowlisted HighLevel bridge operations only: `contacts.list/create/update`, `conversations.list/messages/send`, `calendars.list/availability`, `appointments.list`. No other CRM surface is reachable from generated code.
- No offline/demo mode exists or is planned — HighLevel connection is mandatory for generation, by design.
- HighLevel webhooks (Ed25519-verified, current signature scheme only) fan relevant events out to the workspace; generated apps handle HighLevel list pagination via the `meta` cursor fields.

## Evidence on Hand

- The README (`README.md`) documents the full feature set, architecture decisions, and setup/deployment flow in detail and can be treated as authoritative product description.
- No testimonials, case studies, pricing, or customer evidence exist and none should be fabricated.

## Product Principles

1. Real data or nothing — never let generated UI imply live CRM data when none is connected or a call has failed.
2. Trust through visibility — streaming generation, diffs, and snapshot/restore exist so the user always knows what changed and can undo it.
3. Contain the generated code — the sandboxed iframe and bridge/proxy boundary are load-bearing product guarantees, not incidental implementation detail.
4. Iterate, don't restart — follow-up prompts should feel like revising a real collaborator's work, not re-rolling a dice.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established beyond sound defaults (the current shadcn-vue/reka-ui component base has reasonable accessibility characteristics out of the box).
