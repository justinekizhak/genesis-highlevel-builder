import { diffLines } from 'diff'
import type { GeneratedFile } from '@/types/generation'

export type GenerationDiffLine = {
  kind: 'added' | 'removed' | 'context'
  value: string
}

export type GenerationFileDiff = {
  path: string
  added: number
  removed: number
  lines: GenerationDiffLine[]
}

export function buildGenerationDiff(
  before: Record<string, GeneratedFile>,
  after: Record<string, GeneratedFile>,
): GenerationFileDiff[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return paths.flatMap((path) => {
    const previous = before[path]?.content ?? ''
    const current = after[path]?.content ?? ''
    if (previous === current) return []
    const lines = diffLines(previous, current).flatMap((part) => {
      const kind: GenerationDiffLine['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'context'
      return part.value.replace(/\n$/, '').split('\n').map((value) => ({ kind, value }))
    })
    return [{
      path,
      added: lines.filter((line) => line.kind === 'added').length,
      removed: lines.filter((line) => line.kind === 'removed').length,
      lines: lines.slice(0, 800),
    }]
  })
}
