export type GeneratedFile = {
  path: string
  content: string
  language: string
}

export const generationModels = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
] as const

export type GenerationModel = (typeof generationModels)[number]['value']

export function isGenerationModel(value: string): value is GenerationModel {
  return generationModels.some((model) => model.value === value)
}

export type GenerationEvent =
  | { type: 'generation_started'; generationId: string; provider?: 'openai'; model?: string }
  | { type: 'token'; delta: string }
  | { type: 'file_start'; path: string; language: string }
  | { type: 'file_delta'; path: string; delta: string }
  | { type: 'file_complete'; path: string; size: number; sha256?: string }
  | { type: 'snapshot_created'; snapshotId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'complete'; generationId: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
}

export type ProjectSnapshot = {
  id: string
  generationId?: string
  prompt: string
  summary: string
  label?: string
  provider: string
  model?: string
  kind?: 'generation' | 'partial' | 'backup' | 'manual'
  fileCount: number
  createdAt: string
}
