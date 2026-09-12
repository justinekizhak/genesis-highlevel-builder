import { defineSecret, defineString } from 'firebase-functions/params'
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
https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js. Tailwind CSS is supported through
https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.12. These are the only remote resources allowed in index.html.
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

Never call a write method on page load; expose it only behind a clear user action. The host asks the user to confirm each write.
The bridge is always present and backed by a real, connected HighLevel location: call it immediately on load and render
whatever it returns. Never fabricate, hardcode, or fall back to placeholder contacts, conversations, or appointments — if a
call fails, show a clear loading or error state instead of invented data. Build a complete responsive UI.
For appointments, first list calendars, choose a calendar ID, and pass millisecond startTime and endTime values.
Treat all CRM strings as untrusted. Render them with textContent or DOM node construction, never innerHTML interpolation.
When current files are supplied, revise them according to the latest request rather than discarding useful behavior.`

type OpenAiStreamEvent = {
  type?: string
  delta?: string
  message?: string
  code?: string
  error?: { message?: string; code?: string; type?: string }
  response?: { error?: { message?: string; code?: string; type?: string } }
}

function eventData(block: string) {
  return block.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
}

const QUOTA_ERROR_PATTERN = /insufficient_quota|quota|billing/i

function friendlyOpenAiError(status: number | undefined, event: OpenAiStreamEvent): string {
  const detail = event.error ?? event.response?.error
  const code = detail?.code ?? event.code
  const raw = detail?.message ?? event.message ?? ''
  if (status === 429 || code === 'insufficient_quota' || QUOTA_ERROR_PATTERN.test(raw) || QUOTA_ERROR_PATTERN.test(code ?? '')) {
    return "Genesis's AI generation capacity is temporarily exhausted. This isn't something you can fix — please try again in a few minutes, or contact support if it persists."
  }
  if (status === 401) {
    return 'OpenAI rejected OPENAI_API_KEY (401). Update the Firebase secret with a valid API key, then redeploy generateApp.'
  }
  return raw || `OpenAI request failed${status ? ` (${status})` : ''}.`
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

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
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
    }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as OpenAiStreamEvent
    throw new Error(friendlyOpenAiError(response.status, body))
  }
  if (!response.body) throw new Error('OpenAI returned no response stream.')

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let text = ''
  while (true) {
    const { done, value = '' } = await reader.read()
    buffer += value.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const data = eventData(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      if (!data || data === '[DONE]') continue
      const event = JSON.parse(data) as OpenAiStreamEvent
      if (event.type === 'response.output_text.delta' && event.delta) {
        text += event.delta
        onDelta?.(event.delta)
      }
      if (event.type === 'error') throw new Error(friendlyOpenAiError(undefined, event))
      if (event.type === 'response.failed') throw new Error(friendlyOpenAiError(undefined, event))
    }
    if (done) break
  }
  if (!text) throw new Error('The model returned no application output.')
  return generatedApplicationSchema.parse(JSON.parse(text))
}
