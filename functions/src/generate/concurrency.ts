/**
 * Bounded worker pool. Results keep input order and failures are captured rather than thrown, so
 * one failed item never cancels a viable sibling; only an abort stops the pool.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      signal.throwIfAborted()
      const index = cursor++
      try { results[index] = { status: 'fulfilled', value: await worker(values[index]!, index) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  })
  await Promise.all(runners)
  return results
}
