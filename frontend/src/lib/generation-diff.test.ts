import { describe, expect, it } from 'vitest'
import { buildGenerationDiff } from './generation-diff'

const file = (path: string, content: string) => ({ path, content, language: 'javascript' })

describe('buildGenerationDiff', () => {
  it('reports line additions and removals for changed files', () => {
    const result = buildGenerationDiff(
      { 'app.js': file('app.js', 'const one = 1\n') },
      { 'app.js': file('app.js', 'const one = 2\nconst two = 2\n') },
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: 'app.js', added: 2, removed: 1 })
  })

  it('omits unchanged files', () => {
    const source = { 'app.js': file('app.js', 'same') }
    expect(buildGenerationDiff(source, source)).toEqual([])
  })
})
