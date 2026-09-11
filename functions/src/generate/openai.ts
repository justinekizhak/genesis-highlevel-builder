import { defineSecret, defineString } from 'firebase-functions/params'
import { generatedApplicationSchema, applicationJsonSchema, type GeneratedApplication } from './application.js'

export const openAiApiKey = defineSecret('OPENAI_API_KEY')
export const openAiModel = defineString('OPENAI_MODEL', { default: 'gpt-5.4-mini' })

const systemPrompt = `You generate small, accessible browser applications for HighLevel users.
Return exactly index.html, styles.css, and app.js. Keep the schema property order and order the files as index.html,
styles.css, then app.js so each file can be safely parsed while it streams. The HTML must contain markup only and load no remote resources.
Use vanilla JavaScript and CSS. Never emit credentials, OAuth tokens, script tags, inline event handlers, eval, Function,
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
- window.genesis.highlevel.appointments.list(parameters)

Never call a write method on page load; expose it only behind a clear user action. The host asks the user to confirm each write.
The bridge may be absent in preview mode, so include tasteful demo data and a clear fallback. Build a complete responsive UI.
When current files are supplied, revise them according to the latest request rather than discarding useful behavior.`

type OpenAiStreamEvent = {
  type?: string
  delta?: string
  message?: string
  error?: { message?: string }
  response?: { error?: { message?: string } }
}

function eventData(block: string) {
  return block.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
}

export async function generateWithOpenAi(
  prompt: string,
  currentFiles: Record<string, string>,
  signal?: AbortSignal,
  onDelta?: (delta: string) => void,
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
      input: `User request:\n${prompt}\n\nCurrent files:\n${JSON.stringify(currentFiles)}`,
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
    throw new Error(body.error?.message ?? body.message ?? `OpenAI request failed (${response.status}).`)
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
      if (event.type === 'error') throw new Error(event.message ?? event.error?.message ?? 'OpenAI streaming failed.')
      if (event.type === 'response.failed') throw new Error(event.response?.error?.message ?? event.error?.message ?? 'OpenAI generation failed.')
    }
    if (done) break
  }
  if (!text) throw new Error('The model returned no application output.')
  return generatedApplicationSchema.parse(JSON.parse(text))
}
