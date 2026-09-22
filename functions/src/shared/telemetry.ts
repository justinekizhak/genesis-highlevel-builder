import { logger } from 'firebase-functions'
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

/**
 * Above this, a request/operation logs at `warn` instead of `info` so slow calls are easy to
 * isolate in Cloud Logging (`severity>=WARNING`) without a metrics backend.
 */
const SLOW_REQUEST_MS = 3_000
const SLOW_OPERATION_MS = 1_000

/**
 * Times one internal operation (a Firestore round trip, an OpenAI call, an outbound HTTP request)
 * and logs a structured `perf.operation` entry with its duration, win or lose. Kept generic so
 * every call site — persistence, OpenAI, HighLevel — produces log entries with the same shape,
 * which is what makes them queryable/graphable as one metric in Cloud Logging.
 */
export async function timeOperation<T>(
  operation: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await fn()
    const durationMs = Date.now() - startedAt
    const entry = { operation, durationMs, ...fields }
    if (durationMs >= SLOW_OPERATION_MS) logger.warn('perf.operation', entry)
    else logger.info('perf.operation', entry)
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt
    logger.warn('perf.operation', {
      operation,
      durationMs,
      ...fields,
      failed: true,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Wraps an `onRequest` handler to log one `perf.request` entry per call: route, method, status,
 * and total wall-clock duration. `finish` fires only once the response is fully flushed, so a
 * streaming SSE route (generateApp) is timed end-to-end rather than just to first byte — that's
 * the number that matches what a client actually experiences as latency.
 */
export function withRequestTiming<H extends (request: Request, response: Response) => void | Promise<void>>(
  route: string,
  handler: H,
): H {
  return (async (request: Request, response: Response) => {
    const startedAt = Date.now()
    response.on('finish', () => {
      const durationMs = Date.now() - startedAt
      const entry = {
        route,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs,
      }
      if (durationMs >= SLOW_REQUEST_MS) logger.warn('perf.request', entry)
      else logger.info('perf.request', entry)
    })
    await handler(request, response)
  }) as H
}
