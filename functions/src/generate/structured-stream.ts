import { createHash } from 'node:crypto'
import type { GenerationEvent } from '../shared/protocol.js'
import { safeGrowingPrefixEnd } from './surrogate-safe-chunk.js'

const allowedPaths = new Set(['index.html', 'styles.css', 'app.js'])

type DecodedString = {
  complete: boolean
  end: number
  value: string
}

function decodeStringAt(source: string, quoteIndex: number): DecodedString {
  let value = ''
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const character = source[index]!
    if (character === '"') return { complete: true, end: index + 1, value }
    if (character !== '\\') {
      value += character
      continue
    }

    if (index + 1 >= source.length) return { complete: false, end: index, value }
    const escaped = source[index + 1]!
    const simpleEscapes: Record<string, string> = {
      '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
    }
    if (escaped in simpleEscapes) {
      value += simpleEscapes[escaped]
      index += 1
      continue
    }
    if (escaped === 'u') {
      const digits = source.slice(index + 2, index + 6)
      if (digits.length < 4) return { complete: false, end: index, value }
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) throw new Error('The model returned an invalid JSON escape.')
      value += String.fromCharCode(Number.parseInt(digits, 16))
      index += 5
      continue
    }
    throw new Error('The model returned an invalid JSON escape.')
  }
  return { complete: false, end: source.length, value }
}

function findStringProperty(source: string, name: string, from = 0) {
  let inString = false
  let escaped = false
  for (let index = from; index < source.length; index += 1) {
    const character = source[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character !== '"') continue
    const decoded = decodeStringAt(source, index)
    if (!decoded.complete) return undefined
    let cursor = decoded.end
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
    if (decoded.value === name && source[cursor] === ':') {
      cursor += 1
      while (/\s/.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] !== '"') return undefined
      return { start: cursor, decoded: decodeStringAt(source, cursor) }
    }
    index = decoded.end - 1
  }
  return undefined
}

export class StructuredApplicationStream {
  private source = ''
  private summaryLength = 0
  private readonly fileLengths = new Map<string, number>()
  private readonly completedFiles = new Set<string>()
  private readonly fileContents = new Map<string, string>()

  push(delta: string): GenerationEvent[] {
    this.source += delta
    const events: GenerationEvent[] = []
    const summary = findStringProperty(this.source, 'summary')
    if (summary && summary.decoded.value.length > this.summaryLength) {
      events.push({ type: 'token', delta: summary.decoded.value.slice(this.summaryLength) })
      this.summaryLength = summary.decoded.value.length
    }

    let cursor = 0
    while (true) {
      const pathProperty = findStringProperty(this.source, 'path', cursor)
      if (!pathProperty || !pathProperty.decoded.complete) break
      const path = pathProperty.decoded.value
      cursor = pathProperty.decoded.end
      if (!allowedPaths.has(path)) continue
      const contentProperty = findStringProperty(this.source, 'content', cursor)
      if (!contentProperty) break
      const content = contentProperty.decoded.value
      const emittedLength = this.fileLengths.get(path) ?? 0
      if (!this.fileLengths.has(path)) {
        events.push({ type: 'file_start', path, language: path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html' })
        this.fileLengths.set(path, 0)
      }
      this.fileContents.set(path, content)
      // Hold back a trailing lone surrogate half until its pair arrives, unless this is the
      // final flush (content is complete and no more bytes are coming) — see
      // surrogate-safe-chunk.ts for why a split pair corrupts the checksum.
      const deltaEnd = contentProperty.decoded.complete
        ? content.length
        : safeGrowingPrefixEnd(content, emittedLength)
      if (deltaEnd > emittedLength) {
        events.push({ type: 'file_delta', path, delta: content.slice(emittedLength, deltaEnd) })
        this.fileLengths.set(path, deltaEnd)
      }
      if (contentProperty.decoded.complete && !this.completedFiles.has(path)) {
        events.push({
          type: 'file_complete',
          path,
          size: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
        })
        this.completedFiles.add(path)
      }
      cursor = contentProperty.decoded.end
    }
    return events
  }

  text() {
    return this.source
  }

  partialFiles() {
    return Object.fromEntries(this.fileContents)
  }

  partialSummary() {
    return findStringProperty(this.source, 'summary')?.decoded.value ?? ''
  }
}
