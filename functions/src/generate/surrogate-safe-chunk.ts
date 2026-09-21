/**
 * Splitting a JS string at an arbitrary UTF-16 index can land inside a surrogate pair (e.g. an
 * emoji). Each chunk is later UTF-8 encoded independently for its own SSE frame, and a lone
 * surrogate cannot be represented in UTF-8 — encoders replace it with U+FFFD. The chunk boundary
 * therefore corrupts one character without changing its length, so a size check passes but the
 * sha256 computed over the untouched original string no longer matches what the client
 * reassembles. `clampToSurrogateBoundary` nudges a candidate boundary off the middle of a pair.
 */
export function clampToSurrogateBoundary(content: string, index: number, from: number): number {
  if (index <= from || index >= content.length) return index
  const before = content.charCodeAt(index - 1)
  const after = content.charCodeAt(index)
  const splitsPair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
  if (!splitsPair) return index
  return index - 1 > from ? index - 1 : Math.min(index + 1, content.length)
}

/** Splits `content` into `chunkSize`-ish pieces without ever cutting a surrogate pair in half. */
export function chunkSurrogateSafe(content: string, chunkSize: number): string[] {
  const chunks: string[] = []
  let index = 0
  while (index < content.length) {
    const end = clampToSurrogateBoundary(content, Math.min(index + chunkSize, content.length), index)
    chunks.push(content.slice(index, end))
    index = end
  }
  return chunks
}

/**
 * For a `content` prefix that is still growing (more of the string may arrive later), returns
 * the largest end index beyond `from` that is safe to emit now — i.e. it never ends on a lone
 * high surrogate whose low half hasn't shown up yet. Unlike `clampToSurrogateBoundary`, reaching
 * `content.length` is not assumed safe, since the pair may simply not have arrived yet.
 */
export function safeGrowingPrefixEnd(content: string, from: number): number {
  const end = content.length
  if (end <= from) return end
  const last = content.charCodeAt(end - 1)
  const isLoneHighSurrogate = last >= 0xd800 && last <= 0xdbff
  return isLoneHighSurrogate ? end - 1 : end
}
