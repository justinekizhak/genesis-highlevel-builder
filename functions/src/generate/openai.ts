import { defineSecret, defineString } from 'firebase-functions/params'
import { generatedApplicationSchema, applicationJsonSchema, type GeneratedApplication } from './application.js'

export const openAiApiKey = defineSecret('OPENAI_API_KEY')
export const openAiModel = defineString('OPENAI_MODEL', { default: 'gpt-5.4-mini' })

const systemPrompt = `You generate small, accessible browser applications for HighLevel users.
Return exactly index.html, styles.css, and app.js. The HTML must contain markup only and load no remote resources.
Use vanilla JavaScript and CSS. Never emit credentials, OAuth tokens, script tags, inline event handlers, eval, Function,
dynamic script injection, service workers, localStorage access, or parent/top window access.

When HighLevel data is needed, call only the injected bridge:
- window.genesis.highlevel.contacts.list(parameters)
- window.genesis.highlevel.conversations.list(parameters)
- window.genesis.highlevel.conversations.messages(parameters)
- window.genesis.highlevel.calendars.list(parameters)
- window.genesis.highlevel.appointments.list(parameters)

The bridge may be absent in preview mode, so include tasteful demo data and a clear fallback. Build a complete responsive UI.
When current files are supplied, revise them according to the latest request rather than discarding useful behavior.`

type OpenAiResponse = {
  output_text?: string
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  error?: { message?: string }
}

function outputText(response: OpenAiResponse) {
  if (response.output_text) return response.output_text
  return response.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text ?? '')
    .join('') ?? ''
}

export async function generateWithOpenAi(
  prompt: string,
  currentFiles: Record<string, string>,
  signal?: AbortSignal,
): Promise<GeneratedApplication> {
  const apiKey = openAiApiKey.value()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: openAiModel.value(),
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

  const body = await response.json() as OpenAiResponse
  if (!response.ok) throw new Error(body.error?.message ?? `OpenAI request failed (${response.status}).`)
  const text = outputText(body)
  if (!text) throw new Error('The model returned no application output.')
  return generatedApplicationSchema.parse(JSON.parse(text))
}
