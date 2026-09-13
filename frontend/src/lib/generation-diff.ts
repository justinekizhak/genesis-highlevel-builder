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

export function firstChangedLine(before: string, after: string): number | undefined {
  if (before === after) return undefined

  let line = 1
  for (const part of diffLines(before, after)) {
    if (part.added || part.removed) {
      const lastLine = Math.max(1, after.split('\n').length - (after.endsWith('\n') ? 1 : 0))
      return Math.min(line, lastLine)
    }
    line += part.count ?? 0
  }

  return 1
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
