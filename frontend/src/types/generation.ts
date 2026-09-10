export type GeneratedFile = {
  path: string
  content: string
  language: string
}

export type GenerationEvent =
  | { type: 'generation_started'; generationId: string }
  | { type: 'token'; delta: string }
  | { type: 'file_start'; path: string; language: string }
  | { type: 'file_delta'; path: string; delta: string }
  | { type: 'file_complete'; path: string; size: number }
  | { type: 'snapshot_created'; snapshotId: string }
  | { type: 'complete'; generationId: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}
