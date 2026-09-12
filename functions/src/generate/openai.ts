import { defineSecret, defineString } from 'firebase-functions/params'
import OpenAI, { APIError } from 'openai'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.js'
import { generatedApplicationSchema, applicationJsonSchema, type GeneratedApplication } from './application.js'
import type { GenerationContext } from './persistence.js'

export const openAiApiKey = defineSecret('OPENAI_API_KEY')
export const openAiModel = defineString('OPENAI_MODEL', { default: 'gpt-5.4-mini' })

const systemPrompt = `You generate small, accessible browser applications for HighLevel users.
Every generated application is HighLevel-focused. Unless the user explicitly names another system, interpret contacts,
conversations, and calendars as HighLevel contacts, HighLevel conversations, and HighLevel calendars. Implement those
features with the injected HighLevel bridge described below rather than generic browser data models or unrelated APIs.
Return exactly index.html, styles.css, and app.js. Keep the schema property order and order the files as index.html,
styles.css, then app.js so each file can be safely parsed while it streams. Build Vue 3 applications with the global build from
https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js. 
Prefer writing every style by hand in styles.css; a small hand-written stylesheet reads far cleaner than a framework at this scale, so
do not add Tailwind or another CSS framework.
Never emit credentials, OAuth tokens, inline event handlers, eval, Function,
dynamic script injection, service workers, localStorage access, or parent/top window access.

When HighLevel data is needed, call only the injected bridge:
- window.genesis.highlevel.contacts.list(parameters)
- window.genesis.highlevel.contacts.create(parameters)
- window.genesis.highlevel.contacts.update({ contactId, ...changes })
- window.genesis.highlevel.conversations.list(parameters)
- window.genesis.highlevel.conversations.messages(parameters)
- window.genesis.highlevel.conversations.send({ type, contactId, message, status })
- window.genesis.highlevel.calendars.list(parameters)
- window.genesis.highlevel.calendars.availability({ calendarId, startDate, endDate, timezone })
- window.genesis.highlevel.appointments.list({ calendarId, startTime, endTime })
- window.genesis.highlevel.events.subscribe(callback) — registers callback(event) for live HighLevel webhook
  events (event.type is one of ContactCreate, ContactUpdate, ContactDelete, InboundMessage, AppointmentCreate,
  AppointmentUpdate; event.payload carries the raw webhook body). Returns an unsubscribe function.

If the app displays contacts, conversations, or appointments, call events.subscribe once on load and, on a matching
event type, silently re-run the relevant list call and update the rendered list in place — do not show a toast or
reload the page, just keep the list current.

Never call a write method on page load; expose it only behind a clear user action. The host asks the user to confirm each write.
The bridge is always present and backed by a real, connected HighLevel location: call it immediately on load and render
whatever it returns. Never fabricate, hardcode, or fall back to placeholder contacts, conversations, or appointments — if a
call fails, show a clear loading or error state instead of invented data. Build a complete responsive UI.
For appointments, first list calendars, choose a calendar ID, and pass millisecond startTime and endTime values.
Treat all CRM strings as untrusted. Render them with textContent or DOM node construction, never innerHTML interpolation.
When current files are supplied, revise them according to the latest request rather than discarding useful behavior.

HighLevel list responses include a "meta" object. When it carries a further-page cursor (contacts.list:
meta.startAfterId + meta.startAfter; conversations.list: meta.startAfterDate), render a single "Load more" control at the
end of the list that re-calls the same operation with that cursor and appends the results, instead of replacing them.
Hide the control once a response's meta has no further cursor. Never build your own offset/page-number pagination —
only use the cursor fields HighLevel returns.

Match the visual style of the Genesis host application so the generated app feels native to it, not like a generic
template — and, since this is a small hand-written stylesheet rather than a design system, follow this method exactly
rather than improvising per screen:
1. Open styles.css by defining these custom properties on :root and never introduce a color, spacing, or radius value
   outside this set anywhere else in the file:
   --bg: #11110f; --surface: #1d1c18; --surface-2: #201f1b; --border: #34332d;
   --text: #eeeae0; --text-muted: #8c8980; --accent: #e8bd62; --accent-ink: #1b1914; --danger: #b3453f;
   --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px;
   --radius-sm: 6px; --radius-md: 8px;
   --font-body: ui-sans-serif, system-ui, sans-serif; --font-mono: ui-monospace, monospace;
2. Two type sizes only: 14px/1.5 for body copy and labels, 20px/600 for the one page heading. No other font sizes.
3. One accent color rule: var(--accent) is the only saturated color anywhere on the page — the primary button fill and
   nothing else (not links, not icons, not multiple badges). Every other surface, border, and text color comes from the
   neutral variables above. If a screen seems to need a second "important" color, reuse var(--accent) more sparingly
   instead of adding one.
4. Maximum two levels of visual nesting: page background -> one panel/card per logical section -> rows or fields inside
   it. Never wrap a wrapper, never put a bordered box inside another bordered box "for structure" — a heading and some
   vertical spacing (var(--space-4) or var(--space-5) between sections) does that job instead. Only give an element a
   border or var(--surface) background when it is a genuinely distinct card, input, or button — not every div.
5. Reuse these exact patterns for every screen instead of inventing new ones per view:
   - Primary button: var(--accent) background, var(--accent-ink) text, var(--radius-sm), padding var(--space-2)
     var(--space-4), no border. Exactly one per screen.
   - Secondary/ghost button: transparent background, var(--border) 1px border (ghost: no border until hover), var(--text)
     text, same radius and padding as primary.
   - Input/textarea: var(--surface-2) background, 1px var(--border), var(--radius-sm), var(--accent) border on focus.
   - List row: no border between rows inside the same card — separate with padding (var(--space-3) vertical) only; the
     card's own border is the only line drawn.
   - Empty state: centered text in var(--text-muted), one line, inside the same panel the list would occupy.
   - Loading state: a short var(--text-muted) line ("Loading contacts...") in place of the list — no spinner graphics.
   - Error state: var(--danger) text plus a short retry button, inside the same panel, never a full-page takeover.
6. Rounded corners only from --radius-sm/--radius-md, hairline 1px var(--border) borders instead of shadows, compact
   padding from the spacing scale above. Build every screen (including empty/loading/error states) with only these
   rules — consistency across the whole app matters far more than any single screen looking distinctive.`

type FriendlyErrorDetail = {
  message?: string
  code?: string | null
}

const QUOTA_ERROR_PATTERN = /insufficient_quota|quota|billing/i

function friendlyOpenAiError(status: number | undefined, detail: FriendlyErrorDetail): string {
  const code = detail.code ?? undefined
  const raw = detail.message ?? ''
  if (status === 429 || code === 'insufficient_quota' || QUOTA_ERROR_PATTERN.test(raw) || QUOTA_ERROR_PATTERN.test(code ?? '')) {
    return "Genesis's AI generation capacity is temporarily exhausted. This isn't something you can fix — please try again in a few minutes, or contact support if it persists."
  }
  if (status === 401) {
    return 'OpenAI rejected OPENAI_API_KEY (401). Update the Firebase secret with a valid API key, then redeploy generateApp.'
  }
  return raw || `OpenAI request failed${status ? ` (${status})` : ''}.`
}

function errorEventDetail(event: ResponseStreamEvent): FriendlyErrorDetail {
  if (event.type === 'error') return { message: event.message, code: event.code ?? undefined }
  if (event.type === 'response.failed') {
    const failure = event.response.error
    return { message: failure?.message, code: failure?.code ?? undefined }
  }
  return {}
}

export function buildModelInput(prompt: string, currentFiles: Record<string, string>, context?: GenerationContext) {
  const boundedContext = context ? {
    project: context.project,
    recentMessages: context.recentMessages.slice(-12),
  } : { project: null, recentMessages: [] }
  return `Project and recent conversation context:\n${JSON.stringify(boundedContext)}\n\nUser request:\n${prompt}\n\nCurrent files:\n${JSON.stringify(currentFiles)}`
}

export async function generateWithOpenAi(
  prompt: string,
  currentFiles: Record<string, string>,
  signal?: AbortSignal,
  onDelta?: (delta: string) => void,
  context?: GenerationContext,
): Promise<GeneratedApplication> {
  const apiKey = openAiApiKey.value()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

  const client = new OpenAI({ apiKey })

  let stream: AsyncIterable<ResponseStreamEvent>
  try {
    stream = await client.responses.create({
      model: openAiModel.value(),
      stream: true,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 18_000,
      instructions: systemPrompt,
      input: buildModelInput(prompt, currentFiles, context),
      text: {
        format: {
          type: 'json_schema',
          name: 'generated_highlevel_application',
          strict: true,
          schema: applicationJsonSchema,
        },
      },
    }, { signal })
  } catch (error) {
    if (error instanceof APIError) {
      const body = error.error as { message?: string } | null | undefined
      throw new Error(friendlyOpenAiError(error.status, { message: body?.message ?? error.message, code: error.code }))
    }
    throw error
  }

  let text = ''
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta' && event.delta) {
      text += event.delta
      onDelta?.(event.delta)
    }
    if (event.type === 'error' || event.type === 'response.failed') {
      throw new Error(friendlyOpenAiError(undefined, errorEventDetail(event)))
    }
  }
  if (!text) throw new Error('The model returned no application output.')
  return generatedApplicationSchema.parse(JSON.parse(text))
}
