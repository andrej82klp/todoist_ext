/**
 * Minimal in-process rate limiter for high-risk API endpoints.
 *
 * State is held in memory and is NOT shared across process instances or
 * server restarts. This is intentional for a single-instance MVP deployment.
 * For horizontal scaling, replace the backing store with Redis or a DB table.
 *
 * Usage:
 *   // at module level in a route file:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 20 })
 *
 *   // inside the handler:
 *   if (!checkRateLimit(limiter, event, 'per-user', user.id)) {
 *     throw tooManyRequestsError()
 *   }
 */

import type { H3Event } from 'h3'
import { getHeader } from 'h3'

import { logger } from './logger'

export interface RateLimiterOptions {
  /** Duration of the sliding window in milliseconds. */
  windowMs: number
  /** Maximum number of requests allowed per key per window. */
  max: number
}

interface Bucket {
  count: number
  resetsAt: number
}

export interface RateLimiter {
  options: RateLimiterOptions
  /** Exposed for testing and reset in isolation. */
  buckets: Map<string, Bucket>
}

/** Create a rate limiter instance. Store at module level so the window
 *  persists across requests within the same process. */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  return { options, buckets: new Map() }
}

function clientIp(event: H3Event): string {
  return (
    getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    ?? getHeader(event, 'x-real-ip')
    ?? '0.0.0.0'
  )
}

/**
 * Returns true when the request is within the limit, false when it is over.
 *
 * @param strategy  'per-ip'   — key by client IP (unauthenticated/public routes)
 *                  'per-user' — key by userId (authenticated routes)
 * @param userId    Required when strategy is 'per-user'.
 */
export function checkRateLimit(
  limiter: RateLimiter,
  event: H3Event,
  strategy: 'per-ip' | 'per-user',
  userId?: string
): boolean {
  const key
    = strategy === 'per-user' && userId
      ? `user:${userId}`
      : `ip:${clientIp(event)}`

  const now = Date.now()
  const bucket = limiter.buckets.get(key)

  if (!bucket || now >= bucket.resetsAt) {
    limiter.buckets.set(key, { count: 1, resetsAt: now + limiter.options.windowMs })
    return true
  }

  bucket.count += 1

  if (bucket.count > limiter.options.max) {
    logger.warn('rate_limit_exceeded', {
      key,
      route: event.path,
      method: event.method
    })
    return false
  }

  return true
}
