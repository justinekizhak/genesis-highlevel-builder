export type GenerationEvent =
  | { type: 'generation_started'; generationId: string; provider?: 'openai'; model?: string }
  | { type: 'token'; delta: string }
  | { type: 'file_start'; path: string; language: string }
  | { type: 'file_delta'; path: string; delta: string }
  | { type: 'file_complete'; path: string; size: number; sha256: string }
  | { type: 'snapshot_created'; snapshotId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'complete'; generationId: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

export function serializeSse(event: GenerationEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}
