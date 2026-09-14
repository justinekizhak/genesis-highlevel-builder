# HighLevel Marketplace Listing Kit

This is source copy for the Marketplace submission. The listing is not submission-ready until the final URLs, support address, and screenshot privacy check below are complete.

> **Screenshot privacy gate:** The current captures visibly include an account email address and contact phone numbers. Confirm every value belongs to the approved synthetic sandbox or recapture the affected screens before uploading them to the Marketplace.

## Identity

- App name: **Genesis — AI App Builder**
- Category: Developer Tools / Productivity
- Tagline: **Turn a prompt into a live HighLevel app.**
- Square icon: [`frontend/public/brand/genesis-mark.svg`](../frontend/public/brand/genesis-mark.svg)
- Horizontal wordmark: [`frontend/public/brand/genesis-wordmark.svg`](../frontend/public/brand/genesis-wordmark.svg)
- Brand colors: charcoal `#11110f`, warm white `#f0eee7`, gold `#dfb85f`

Export the square source to PNG at the exact dimensions required by the Marketplace form (keep the safe area and rounded background; do not add small text). Export the wordmark only when a horizontal asset is requested.

## Short description

Build focused apps for your HighLevel contacts, conversations, and calendars from a plain-English prompt—then refine the code and preview with real CRM data.

## Full description

Genesis turns a plain-English workflow into a working mini-app connected to your HighLevel location. Describe a contact workspace, conversation console, booking view, or internal tool and watch Genesis stream the implementation into a live code editor and preview.

Unlike a mockup generator, Genesis requires a connected HighLevel location and uses your real, authorized CRM data. Generated apps access only an allowlisted set of Contacts, Conversations, Calendars, and Appointment operations. OAuth credentials stay on the server and are never exposed to generated code.

Keep control as the app evolves: refine it with follow-up prompts, review file-level changes, edit the HTML, CSS, and JavaScript directly, and restore any generation or manual-save snapshot. Stop an in-progress generation without losing completed work.

Key capabilities:

- Prompt-to-app generation with live streaming
- Real HighLevel contacts, conversations, calendars, and appointments
- Monaco code editor and sandboxed live preview
- Iterative refinements and visible diffs
- Automatic and manual-save snapshots with restore
- Authenticated, allowlisted, and rate-limited HighLevel access

Genesis is designed for technical agency operators and developers who want to prototype focused HighLevel tools quickly while retaining visibility into the code and control over every change.

## Screenshot inventory

Eight 960×540 captures are tracked in `upload-ready-screenshots/`. Use the first five rows as the recommended Marketplace sequence; the remaining three are supplementary product-detail images.

| Priority | Screen | Recommended caption | File |
|---|---|---|---|
| 1 | Connected dashboard | Your connected HighLevel app workspace. | [Dashboard](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_00_PM-960x540.png>) |
| 2 | Prompt, code, and live preview | Describe the workflow, inspect the code, and preview the result in one workspace. | [Workspace](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_02_PM-960x540.png>) |
| 3 | Live contacts preview | Preview against authorized HighLevel contacts and calendars. | [Preview](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_02_PM (1)-960x540.png>) |
| 4 | Snapshot history and diff | Review generated changes and restore an earlier workspace state. | [Snapshot history](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_04_PM-960x540.png>) |
| 5 | Webhook activity | Follow verified HighLevel contact and appointment events as they arrive. | [Webhook activity](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_00_PM (1)-960x540.png>) |
| Extra | Sign-in | Secure access to your HighLevel app builder. | [Sign-in](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_09_59_PM-960x540.png>) |
| Extra | Command palette | Move quickly between workspace actions and panels. | [Command palette](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_03_PM-960x540.png>) |
| Extra | Full code diff | Inspect every generated line before using the app. | [Code diff](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_04_PM (1)-960x540.png>) |

### Recommended Marketplace gallery

![Connected dashboard](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_00_PM-960x540.png>)

![Prompt, code, and live preview workspace](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_02_PM-960x540.png>)

![Live contacts and appointments preview](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_02_PM (1)-960x540.png>)

![Snapshot history and generated diff](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_04_PM-960x540.png>)

![HighLevel webhook activity](<../upload-ready-screenshots/Genesis-HighLevel-App-Builder-09-14-2026_10_00_PM (1)-960x540.png>)

Before submission, confirm the Marketplace's current image dimensions and crop rules. Never include access tokens, real customer PII, developer-console secrets, or unapproved account identifiers. Several captures visibly include account and contact fields, so verify they belong to the dedicated synthetic sandbox or recapture them with approved values.

## Reviewer demo script

1. Sign in and show the persisted session.
2. Connect a dedicated HighLevel sandbox location.
3. Create a project and request a contacts workspace with search and pagination.
4. Show SSE output landing in Monaco and the working preview.
5. Ask for one refinement and open the diff.
6. Make a manual edit, show the new snapshot, and restore the previous version.
7. Show the browser network request to `POST /api/v1/integrations/highlevel/proxy-requests` and explain that tokens never reach the iframe.

## Submission gaps to close

- Replace the README's Loom placeholder with the final public walkthrough URL.
- Publish stable privacy-policy, terms-of-service, support, and account/data-deletion URLs. These should state retention periods and subprocessors, not just describe the architecture.
- Export the icon to the Marketplace's required raster sizes and run a legibility check at 48×48.
- Confirm every visible email address, contact name, and phone number in the tracked screenshots is approved synthetic sandbox data; recapture any image that fails this check.
- Provide a monitored support email and realistic response-time expectation.
- Verify the requested OAuth scopes exactly match the features shown; remove any unused write scope.
- Complete an install, token refresh, uninstall, and reinstall test using a second sandbox location before review.
