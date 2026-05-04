// Summary: Tests for redemption lifecycle and fulfillment integration.
// Verifies: creating redemptions, state transitions, ledger impacts, and listing of redemptions.
// Requires: test DB (`DATABASE_URL`) and seeded rewards/ledger state for deterministic assertions.

import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import ledgerAdjustmentsPostHandler from '../../server/api/ledger/adjustments.post'
import ledgerGetHandler from '../../server/api/ledger/index.get'
import rewardsPostHandler from '../../server/api/rewards/index.post'
import rewardsPatchHandler from '../../server/api/rewards/[rewardId]/index.patch'
import rewardsRedeemPostHandler from '../../server/api/rewards/[rewardId]/redeem.post'
import redemptionsGetHandler from '../../server/api/rewards/redemptions.get'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'

// Helper: only run DB-backed integration tests when `DATABASE_URL` is configured.
const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

function authHeader(cookie: string) {
  return { cookie }
}

async function createAuthedUser(emailPrefix: string) {
  const db = getDb()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

async function createReward(sessionCookie: string, name: string, costPoints: number) {
  const response = await fetch(`${baseUrl}/api/rewards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
    body: JSON.stringify({ name, costPoints })
  })

  const payload = await response.json()

  return {
    status: response.status,
    rewardId: payload.data.id as string
  }
}

async function adjustPoints(sessionCookie: string, amount: number, reason: string) {
  return fetch(`${baseUrl}/api/ledger/adjustments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
    body: JSON.stringify({ amount, reason })
  })
}

// Setup: boot local H3 server with session middleware and rewards/ledger routes
// to exercise redemption lifecycle end-to-end in tests.
beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-11-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.post('/api/rewards', rewardsPostHandler)
  router.patch('/api/rewards/:rewardId', rewardsPatchHandler)
  router.post('/api/rewards/:rewardId/redeem', rewardsRedeemPostHandler)
  router.get('/api/rewards/redemptions', redemptionsGetHandler)
  router.post('/api/ledger/adjustments', ledgerAdjustmentsPostHandler)
  router.get('/api/ledger', ledgerGetHandler)
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
    server.close(err => err ? reject(err) : resolve())
  })
  await closeDbConnection()
})

// Suite: unauthenticated access control for redemption endpoint.
describe('Milestone 11 — reward redemption API (unauthenticated)', () => {
  it('POST /api/rewards/:rewardId/redeem returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/rewards/00000000-0000-0000-0000-000000000000/redeem`, {
      method: 'POST'
    })

    expect(res.status).toBe(401)
  })
})

// Suite: authenticated redemption flows including error cases and successful redemption.
describe('Milestone 11 — reward redemption API (authenticated)', () => {
  runIfDatabaseConfigured('returns 404 when reward is missing', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('redeem-missing')

    try {
      const response = await fetch(`${baseUrl}/api/rewards/00000000-0000-0000-0000-000000000000/redeem`, {
        method: 'POST',
        headers: authHeader(sessionCookie)
      })
      const payload = await response.json()

      expect(response.status).toBe(404)
      expect(payload.error.code).toBe('NOT_FOUND')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('returns 404 when reward belongs to a different user', async () => {
    const db = getDb()
    const owner = await createAuthedUser('redeem-owner')
    const intruder = await createAuthedUser('redeem-intruder')

    try {
      const { rewardId } = await createReward(owner.sessionCookie, 'Private reward', 20)

      const response = await fetch(`${baseUrl}/api/rewards/${rewardId}/redeem`, {
        method: 'POST',
        headers: authHeader(intruder.sessionCookie)
      })

      expect(response.status).toBe(404)
    } finally {
      await db.delete(users).where(eq(users.id, owner.user.id))
      await db.delete(users).where(eq(users.id, intruder.user.id))
    }
  })

  runIfDatabaseConfigured('returns 404 for archived rewards', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('redeem-archived')

    try {
      const { rewardId } = await createReward(sessionCookie, 'Archived reward', 30)
      await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ isArchived: true })
      })

      const response = await fetch(`${baseUrl}/api/rewards/${rewardId}/redeem`, {
        method: 'POST',
        headers: authHeader(sessionCookie)
      })

      expect(response.status).toBe(404)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('returns 409 INSUFFICIENT_POINTS and does not write history', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('redeem-insufficient')

    try {
      const { rewardId } = await createReward(sessionCookie, 'Expensive reward', 80)

      const response = await fetch(`${baseUrl}/api/rewards/${rewardId}/redeem`, {
        method: 'POST',
        headers: authHeader(sessionCookie)
      })
      const payload = await response.json()

      expect(response.status).toBe(409)
      expect(payload.error.code).toBe('INSUFFICIENT_POINTS')
      expect(payload.error.details).toEqual({
        rewardId,
        missingPoints: 80
      })

      const [historyResponse, ledgerResponse] = await Promise.all([
        fetch(`${baseUrl}/api/rewards/redemptions?page=1&pageSize=20`, { headers: authHeader(sessionCookie) }),
        fetch(`${baseUrl}/api/ledger?page=1&pageSize=20`, { headers: authHeader(sessionCookie) })
      ])
      const historyPayload = await historyResponse.json()
      const ledgerPayload = await ledgerResponse.json()

      expect(historyPayload.data.redemptions).toEqual([])
      expect(ledgerPayload.data.transactions).toEqual([])
      expect(ledgerPayload.data.pointsSummary).toEqual({
        currentBalance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      })
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('redeems successfully and updates points summary, history, and ledger', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('redeem-success')

    try {
      await adjustPoints(sessionCookie, 100, 'seed points')
      const { rewardId } = await createReward(sessionCookie, 'Cinema Night', 70)

      const response = await fetch(`${baseUrl}/api/rewards/${rewardId}/redeem`, {
        method: 'POST',
        headers: authHeader(sessionCookie)
      })
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.data.success).toBe(true)
      expect(payload.data.redemption.rewardId).toBe(rewardId)
      expect(payload.data.redemption.rewardName).toBe('Cinema Night')
      expect(payload.data.redemption.costPoints).toBe(70)
      expect(payload.data.points).toEqual({
        currentBalance: 30,
        lifetimeEarned: 0,
        lifetimeSpent: 70
      })

      const [historyResponse, ledgerResponse] = await Promise.all([
        fetch(`${baseUrl}/api/rewards/redemptions?page=1&pageSize=20`, { headers: authHeader(sessionCookie) }),
        fetch(`${baseUrl}/api/ledger?page=1&pageSize=20`, { headers: authHeader(sessionCookie) })
      ])
      const historyPayload = await historyResponse.json()
      const ledgerPayload = await ledgerResponse.json()

      expect(historyPayload.data.redemptions).toHaveLength(1)
      expect(historyPayload.data.redemptions[0].id).toBe(payload.data.redemption.id)
      expect(ledgerPayload.data.transactions).toHaveLength(2)
      expect(ledgerPayload.data.transactions[0]).toMatchObject({
        type: 'spent',
        amount: 70,
        source: 'reward_redemption',
        relatedEntityType: 'reward_redemption',
        relatedEntityId: payload.data.redemption.id
      })
      expect(ledgerPayload.data.pointsSummary).toEqual({
        currentBalance: 30,
        lifetimeEarned: 0,
        lifetimeSpent: 70
      })
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('returns the original redemption on idempotent retry without duplicate writes', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('redeem-idempotent')

    try {
      await adjustPoints(sessionCookie, 120, 'seed points')
      const { rewardId } = await createReward(sessionCookie, 'Massage voucher', 50)
      const headers = {
        ...authHeader(sessionCookie),
        'Idempotency-Key': `redeem-${Date.now()}`
      }

      const firstResponse = await fetch(`${baseUrl}/api/rewards/${rewardId}/redeem`, {
        method: 'POST',
        headers
      })
      const firstPayload = await firstResponse.json()

      const secondResponse = await fetch(`${baseUrl}/api/rewards/${rewardId}/redeem`, {
        method: 'POST',
        headers
      })
      const secondPayload = await secondResponse.json()

      expect(firstResponse.status).toBe(200)
      expect(secondResponse.status).toBe(200)
      expect(secondPayload.data.redemption.id).toBe(firstPayload.data.redemption.id)
      expect(secondPayload.data.points).toEqual(firstPayload.data.points)

      const [historyResponse, ledgerResponse] = await Promise.all([
        fetch(`${baseUrl}/api/rewards/redemptions?page=1&pageSize=20`, { headers: authHeader(sessionCookie) }),
        fetch(`${baseUrl}/api/ledger?page=1&pageSize=20`, { headers: authHeader(sessionCookie) })
      ])
      const historyPayload = await historyResponse.json()
      const ledgerPayload = await ledgerResponse.json()
      const spentTransactions = ledgerPayload.data.transactions.filter((transaction: { type: string }) => transaction.type === 'spent')

      expect(historyPayload.data.redemptions).toHaveLength(1)
      expect(spentTransactions).toHaveLength(1)
      expect(ledgerPayload.data.pointsSummary).toEqual({
        currentBalance: 70,
        lifetimeEarned: 0,
        lifetimeSpent: 50
      })
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
