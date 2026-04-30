import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import ledgerGetHandler from '../../server/api/ledger/index.get'
import ledgerAdjustmentsPostHandler from '../../server/api/ledger/adjustments.post'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

function authHeader(cookie: string) {
  return { cookie }
}

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-9-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.get('/api/ledger', ledgerGetHandler)
  router.post('/api/ledger/adjustments', ledgerAdjustmentsPostHandler)
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

describe('Milestone 9 — GET /api/ledger (unauthenticated)', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/ledger`)
    expect(res.status).toBe(401)
  })
})

describe('Milestone 9 — POST /api/ledger/adjustments (unauthenticated)', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/ledger/adjustments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 10, reason: 'test' })
    })
    expect(res.status).toBe(401)
  })
})

describe('Milestone 9 — ledger API (authenticated)', () => {
  runIfDatabaseConfigured('GET /api/ledger returns empty ledger and zero balance for new user', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'ledger-get@example.com',
      todoistUserId: 'ledger-todoist-get'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/ledger`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.transactions).toEqual([])
      expect(payload.data.pointsSummary).toEqual({
        currentBalance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      })
      expect(payload.data.meta.total).toBe(0)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST /api/ledger/adjustments rejects amount 0', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'ledger-zero@example.com',
      todoistUserId: 'ledger-todoist-zero'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: 0, reason: 'test' })
      })
      const payload = await res.json()

      expect(res.status).toBe(422)
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST /api/ledger/adjustments rejects empty reason', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'ledger-reason@example.com',
      todoistUserId: 'ledger-todoist-reason'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: 10, reason: '   ' })
      })
      const payload = await res.json()

      expect(res.status).toBe(422)
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST positive adjustment updates balance', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'ledger-pos@example.com',
      todoistUserId: 'ledger-todoist-pos'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const postRes = await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: 100, reason: 'test' })
      })
      const postPayload = await postRes.json()

      expect(postRes.status).toBe(200)
      expect(postPayload.data.transaction.amount).toBe(100)
      expect(postPayload.data.transaction.type).toBe('adjusted')
      expect(postPayload.data.pointsSummary.currentBalance).toBe(100)

      const getRes = await fetch(`${baseUrl}/api/ledger`, {
        headers: authHeader(sessionCookie)
      })
      const getPayload = await getRes.json()

      expect(getRes.status).toBe(200)
      expect(getPayload.data.transactions).toHaveLength(1)
      expect(getPayload.data.transactions[0].amount).toBe(100)
      expect(getPayload.data.pointsSummary.currentBalance).toBe(100)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST negative adjustment reduces balance', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'ledger-neg@example.com',
      todoistUserId: 'ledger-todoist-neg'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: 100, reason: 'seed' })
      })

      const postRes = await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: -30, reason: 'correction' })
      })
      const postPayload = await postRes.json()

      expect(postRes.status).toBe(200)
      expect(postPayload.data.pointsSummary.currentBalance).toBe(70)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
