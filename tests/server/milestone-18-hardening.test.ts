// Milestone 18 — Hardening, security, and observability
// Verifies:
//   1. Validation failures are consistently rejected with 422 across write endpoints.
//   2. Unauthenticated requests return 401 across protected routes.
//   3. Cross-user resource access returns 404, never leaking ownership.
//   4. GET /api/auth/session never exposes OAuth access or refresh tokens.
//   5. Rate limiter helper correctly allows and denies requests.
//   6. Logger redaction masks sensitive keys before emission.

import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import sessionGetHandler from '../../server/api/auth/session.get'
import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import ledgerAdjustmentsPostHandler from '../../server/api/ledger/adjustments.post'
import rewardsPostHandler from '../../server/api/rewards/index.post'
import rewardsPatchHandler from '../../server/api/rewards/[rewardId]/index.patch'
import rewardsDeleteHandler from '../../server/api/rewards/[rewardId]/index.delete'
import rewardsRedeemPostHandler from '../../server/api/rewards/[rewardId]/redeem.post'
import settingsPatchHandler from '../../server/api/settings/index.patch'
import taskMetadataPatchHandler from '../../server/api/tasks/[taskId]/metadata.patch'
import taskMetadataBatchPatchHandler from '../../server/api/tasks/metadata/batch.patch'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'
import { logger, redactForLog } from '../../server/utils/logger'
import { checkRateLimit, createRateLimiter } from '../../server/utils/rate-limit'

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

function authHeader(cookie: string) {
  return { cookie }
}

async function createAuthedUser(emailPrefix: string) {
  const db = getDb()
  const suffix = `m18-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const [user] = await db.insert(users).values({
    email: `${emailPrefix}-${suffix}@example.com`,
    todoistUserId: `${emailPrefix}-${suffix}`
  }).returning()

  await ensureUserDefaults(user.id)

  const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: user.id })
  })

  const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''
  return { user, sessionCookie }
}

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-18-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.get('/api/auth/session', sessionGetHandler)
  router.post('/api/rewards', rewardsPostHandler)
  router.patch('/api/rewards/:rewardId', rewardsPatchHandler)
  router.delete('/api/rewards/:rewardId', rewardsDeleteHandler)
  router.post('/api/rewards/:rewardId/redeem', rewardsRedeemPostHandler)
  router.patch('/api/settings', settingsPatchHandler)
  router.post('/api/ledger/adjustments', ledgerAdjustmentsPostHandler)
  router.patch('/api/tasks/:taskId/metadata', taskMetadataPatchHandler)
  router.patch('/api/tasks/metadata/batch', taskMetadataBatchPatchHandler)
  app.use(router)

  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
  await closeDbConnection()
})

// ── 1. Unauthenticated access (401 guard) ────────────────────────────────────

describe('Milestone 18 — unauthenticated access is rejected', () => {
  const protectedWriteRoutes = [
    { method: 'POST', path: '/api/rewards', body: { name: 'x', costPoints: 10 } },
    { method: 'PATCH', path: '/api/rewards/00000000-0000-0000-0000-000000000001', body: { name: 'y' } },
    { method: 'DELETE', path: '/api/rewards/00000000-0000-0000-0000-000000000001', body: {} },
    { method: 'POST', path: '/api/rewards/00000000-0000-0000-0000-000000000001/redeem', body: {} },
    { method: 'PATCH', path: '/api/settings', body: { difficulty: 2 } },
    { method: 'POST', path: '/api/ledger/adjustments', body: { amount: 5, reason: 'test' } },
    { method: 'PATCH', path: '/api/tasks/00000000-0000-0000-0000-000000000001/metadata', body: { priority: 'medium' } },
    { method: 'PATCH', path: '/api/tasks/metadata/batch', body: { items: [] } }
  ] as const

  for (const { method, path, body } of protectedWriteRoutes) {
    it(`${method} ${path} → 401 without session`, async () => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })

      expect(res.status).toBe(401)
      const payload = await res.json()
      expect(payload.error.code).toBe('UNAUTHORIZED')
    })
  }
})

// ── 2. Input validation (422 on bad payloads) ────────────────────────────────

describe('Milestone 18 — invalid input is consistently rejected', () => {
  runIfDatabaseConfigured('POST /api/rewards with missing name → 422', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('m18-val-rewards')

    try {
      const res = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ costPoints: 10 }) // missing name
      })

      expect(res.status).toBe(422)
      const payload = await res.json()
      expect(payload.error.code).toBe('VALIDATION_ERROR')
      expect(payload.error.details).toBeDefined()
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST /api/rewards with negative costPoints → 422', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('m18-val-rewards-neg')

    try {
      const res = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Test', costPoints: -1 })
      })

      expect(res.status).toBe(422)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST /api/ledger/adjustments with missing reason → 422', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('m18-val-ledger')

    try {
      const res = await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: 10 }) // missing reason
      })

      expect(res.status).toBe(422)
      const payload = await res.json()
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/settings with invalid difficulty → 422', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('m18-val-settings')

    try {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ defaultDifficulty: 999 }) // out of range
      })

      expect(res.status).toBe(422)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/tasks/metadata/batch with non-array items → 422', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('m18-val-batch')

    try {
      const res = await fetch(`${baseUrl}/api/tasks/metadata/batch`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ items: 'not-an-array' })
      })

      expect(res.status).toBe(422)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})

// ── 3. Cross-user scoping (404, not 403) ─────────────────────────────────────

describe('Milestone 18 — cross-user resource access is denied', () => {
  runIfDatabaseConfigured('PATCH /api/rewards/:id owned by other user → 404', async () => {
    const db = getDb()
    const owner = await createAuthedUser('m18-scope-owner')
    const intruder = await createAuthedUser('m18-scope-intruder')

    try {
      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(owner.sessionCookie) },
        body: JSON.stringify({ name: 'Owners reward', costPoints: 50 })
      })
      const created = await createRes.json()
      const rewardId = created.data.id as string

      const patchRes = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(intruder.sessionCookie) },
        body: JSON.stringify({ name: 'Hijacked name' })
      })

      expect(patchRes.status).toBe(404)
      const payload = await patchRes.json()
      expect(payload.error.code).toBe('NOT_FOUND')
    } finally {
      await db.delete(users).where(eq(users.id, owner.user.id))
      await db.delete(users).where(eq(users.id, intruder.user.id))
    }
  })

  runIfDatabaseConfigured('DELETE /api/rewards/:id owned by other user → 404', async () => {
    const db = getDb()
    const owner = await createAuthedUser('m18-del-owner')
    const intruder = await createAuthedUser('m18-del-intruder')

    try {
      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(owner.sessionCookie) },
        body: JSON.stringify({ name: 'Private reward', costPoints: 20 })
      })
      const created = await createRes.json()
      const rewardId = created.data.id as string

      const deleteRes = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'DELETE',
        headers: authHeader(intruder.sessionCookie)
      })

      expect(deleteRes.status).toBe(404)
    } finally {
      await db.delete(users).where(eq(users.id, owner.user.id))
      await db.delete(users).where(eq(users.id, intruder.user.id))
    }
  })

  runIfDatabaseConfigured('POST /api/rewards/:id/redeem for another user reward → 404', async () => {
    const db = getDb()
    const owner = await createAuthedUser('m18-redeem-owner')
    const intruder = await createAuthedUser('m18-redeem-intruder')

    try {
      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(owner.sessionCookie) },
        body: JSON.stringify({ name: 'Secret reward', costPoints: 5 })
      })
      const created = await createRes.json()
      const rewardId = created.data.id as string

      const redeemRes = await fetch(`${baseUrl}/api/rewards/${rewardId}/redeem`, {
        method: 'POST',
        headers: authHeader(intruder.sessionCookie)
      })

      expect(redeemRes.status).toBe(404)
    } finally {
      await db.delete(users).where(eq(users.id, owner.user.id))
      await db.delete(users).where(eq(users.id, intruder.user.id))
    }
  })
})

// ── 4. Token/secret exposure prevention ──────────────────────────────────────

describe('Milestone 18 — session endpoint never exposes OAuth tokens', () => {
  runIfDatabaseConfigured('GET /api/auth/session response contains no token fields', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('m18-session-check')

    try {
      const res = await fetch(`${baseUrl}/api/auth/session`, {
        headers: authHeader(sessionCookie)
      })

      expect(res.status).toBe(200)
      const payload = await res.json()
      const raw = JSON.stringify(payload)

      // The session payload must never include access or refresh token material.
      expect(raw).not.toContain('accessToken')
      expect(raw).not.toContain('access_token')
      expect(raw).not.toContain('refreshToken')
      expect(raw).not.toContain('refresh_token')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  it('GET /api/auth/session when unauthenticated returns authenticated: false, not a 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/session`)
    // session.get is a public route — unauthenticated users get authenticated: false
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload.data.authenticated).toBe(false)
    // Still, no token fields should be present
    const raw = JSON.stringify(payload)
    expect(raw).not.toContain('accessToken')
    expect(raw).not.toContain('refreshToken')
  })
})

// ── 5. Rate limiter helper unit tests ─────────────────────────────────────────

describe('Milestone 18 — rate limiter helper', () => {
  // Create a minimal fake H3Event shape for unit testing the limiter.
  function fakeEvent(ip = '127.0.0.1', path = '/test'): Parameters<typeof checkRateLimit>[1] {
    return {
      path,
      method: 'POST',
      node: { req: { headers: { 'x-forwarded-for': ip } } }
    } as unknown as Parameters<typeof checkRateLimit>[1]
  }

  it('allows requests up to the configured max', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 })
    const event = fakeEvent('10.0.0.1')

    expect(checkRateLimit(limiter, event, 'per-ip')).toBe(true)
    expect(checkRateLimit(limiter, event, 'per-ip')).toBe(true)
    expect(checkRateLimit(limiter, event, 'per-ip')).toBe(true)
  })

  it('rejects the request beyond the max', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 })
    const event = fakeEvent('10.0.0.2')

    checkRateLimit(limiter, event, 'per-ip')
    checkRateLimit(limiter, event, 'per-ip')
    const result = checkRateLimit(limiter, event, 'per-ip')

    expect(result).toBe(false)
  })

  it('scopes per-user keys independently from per-ip keys', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    const event = fakeEvent('10.0.0.3')

    // Two different users share the same IP but have independent buckets.
    expect(checkRateLimit(limiter, event, 'per-user', 'user-a')).toBe(true)
    expect(checkRateLimit(limiter, event, 'per-user', 'user-a')).toBe(false) // over limit
    expect(checkRateLimit(limiter, event, 'per-user', 'user-b')).toBe(true) // separate bucket
  })

  it('resets the bucket after the window expires', async () => {
    const limiter = createRateLimiter({ windowMs: 10, max: 1 })
    const event = fakeEvent('10.0.0.4')

    expect(checkRateLimit(limiter, event, 'per-ip')).toBe(true)
    expect(checkRateLimit(limiter, event, 'per-ip')).toBe(false)

    // Wait for window to expire
    await new Promise(r => setTimeout(r, 20))

    expect(checkRateLimit(limiter, event, 'per-ip')).toBe(true)
  })
})

// ── 6. Logger redaction unit tests ────────────────────────────────────────────

describe('Milestone 18 — logger redaction', () => {
  it('redacts top-level sensitive keys', () => {
    const result = redactForLog({
      accessToken: 'tok_super_secret',
      userId: 'user-123'
    }) as Record<string, unknown>

    expect(result.accessToken).toBe('[REDACTED]')
    expect(result.userId).toBe('user-123')
  })

  it('redacts nested sensitive keys', () => {
    const result = redactForLog({
      payload: {
        access_token: 'secret',
        refresh_token: 'other-secret',
        name: 'Alice'
      }
    }) as Record<string, unknown>

    const payload = result.payload as Record<string, unknown>
    expect(payload.access_token).toBe('[REDACTED]')
    expect(payload.refresh_token).toBe('[REDACTED]')
    expect(payload.name).toBe('Alice')
  })

  it('redacts cookie and authorization headers', () => {
    const result = redactForLog({
      headers: {
        'authorization': 'Bearer abc123',
        'cookie': 'session=xyz',
        'content-type': 'application/json'
      }
    }) as Record<string, unknown>

    const headers = result.headers as Record<string, unknown>
    expect(headers.authorization).toBe('[REDACTED]')
    expect(headers.cookie).toBe('[REDACTED]')
    expect(headers['content-type']).toBe('application/json')
  })

  it('redacts state and code OAuth params', () => {
    const result = redactForLog({ code: 'abc', state: 'xyz123', rewardId: 'rew_1' }) as Record<string, unknown>
    expect(result.code).toBe('[REDACTED]')
    expect(result.state).toBe('[REDACTED]')
    expect(result.rewardId).toBe('rew_1')
  })

  it('truncates very long string values', () => {
    const longString = 'a'.repeat(600)
    const result = redactForLog({ blob: longString }) as Record<string, unknown>
    expect(typeof result.blob).toBe('string')
    expect((result.blob as string).length).toBeLessThan(200)
    expect(result.blob as string).toContain('[truncated]')
  })

  it('passes through safe values unchanged', () => {
    const result = redactForLog({
      userId: 'u-1',
      count: 42,
      flag: true,
      tags: ['a', 'b']
    }) as Record<string, unknown>

    expect(result.userId).toBe('u-1')
    expect(result.count).toBe(42)
    expect(result.flag).toBe(true)
    expect(result.tags).toEqual(['a', 'b'])
  })

  it('does not emit sensitive fields to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      logger.info('test_event', { accessToken: 'super-secret', userId: 'u-safe' })

      expect(spy).toHaveBeenCalledOnce()
      const line = spy.mock.calls[0]?.[0] as string
      expect(line).not.toContain('super-secret')
      expect(line).toContain('[REDACTED]')
      expect(line).toContain('u-safe')
    } finally {
      spy.mockRestore()
    }
  })
})
