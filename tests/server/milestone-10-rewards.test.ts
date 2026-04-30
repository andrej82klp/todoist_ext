import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import ledgerAdjustmentsPostHandler from '../../server/api/ledger/adjustments.post'
import rewardsGetHandler from '../../server/api/rewards/index.get'
import rewardsPostHandler from '../../server/api/rewards/index.post'
import rewardsPatchHandler from '../../server/api/rewards/[rewardId]/index.patch'
import rewardsDeleteHandler from '../../server/api/rewards/[rewardId]/index.delete'
import redemptionsGetHandler from '../../server/api/rewards/redemptions.get'
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
  process.env.SESSION_SECRET ||= 'milestone-10-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.get('/api/rewards', rewardsGetHandler)
  router.get('/api/rewards/redemptions', redemptionsGetHandler)
  router.post('/api/rewards', rewardsPostHandler)
  router.patch('/api/rewards/:rewardId', rewardsPatchHandler)
  router.delete('/api/rewards/:rewardId', rewardsDeleteHandler)
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

describe('Milestone 10 — rewards API (unauthenticated)', () => {
  it('GET /api/rewards returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/rewards`)
    expect(res.status).toBe(401)
  })

  it('POST /api/rewards returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/rewards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', costPoints: 1 })
    })
    expect(res.status).toBe(401)
  })

  it('GET /api/rewards/redemptions returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/rewards/redemptions`)
    expect(res.status).toBe(401)
  })
})

describe('Milestone 10 — rewards API (authenticated)', () => {
  runIfDatabaseConfigured('GET /api/rewards fresh user', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-get@example.com',
      todoistUserId: 'rewards-todoist-get'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/rewards`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.rewards).toEqual([])
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

  runIfDatabaseConfigured('POST /api/rewards missing name returns 422', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-noname@example.com',
      todoistUserId: 'rewards-todoist-noname'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ costPoints: 50 })
      })
      const payload = await res.json()

      expect(res.status).toBe(422)
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST /api/rewards costPoints 0 returns 422', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-zero@example.com',
      todoistUserId: 'rewards-todoist-zero'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Bad', costPoints: 0 })
      })
      const payload = await res.json()

      expect(res.status).toBe(422)
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('POST valid reward returns 201 with affordability', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-create@example.com',
      todoistUserId: 'rewards-todoist-create'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Coffee', costPoints: 50 })
      })
      const payload = await res.json()

      expect(res.status).toBe(201)
      expect(payload.data.name).toBe('Coffee')
      expect(payload.data.costPoints).toBe(50)
      expect(payload.data.affordability.canRedeem).toBe(false)
      expect(payload.data.affordability.missingPoints).toBe(50)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET after create lists one reward', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-list@example.com',
      todoistUserId: 'rewards-todoist-list'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Tea', costPoints: 40 })
      })

      const res = await fetch(`${baseUrl}/api/rewards`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.rewards).toHaveLength(1)
      expect(payload.data.meta.total).toBe(1)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('ledger adjustment updates affordability on GET', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-afford@example.com',
      todoistUserId: 'rewards-todoist-afford'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Snack', costPoints: 50 })
      })

      await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: 100, reason: 'test grant' })
      })

      const res = await fetch(`${baseUrl}/api/rewards`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.rewards[0].affordability.canRedeem).toBe(true)
      expect(payload.data.rewards[0].affordability.missingPoints).toBe(0)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH costPoints updates reward', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-patch@example.com',
      todoistUserId: 'rewards-todoist-patch'
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

      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Book', costPoints: 50 })
      })
      const createPayload = await createRes.json()
      const rewardId = createPayload.data.id as string

      const patchRes = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ costPoints: 200 })
      })
      const patchPayload = await patchRes.json()

      expect(patchRes.status).toBe(200)
      expect(patchPayload.data.costPoints).toBe(200)
      expect(patchPayload.data.affordability.canRedeem).toBe(false)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH wrong user returns 404', async () => {
    const db = getDb()
    const [userA] = await db.insert(users).values({
      email: 'rewards-owner@example.com',
      todoistUserId: 'rewards-todoist-owner'
    }).returning()
    const [userB] = await db.insert(users).values({
      email: 'rewards-intruder@example.com',
      todoistUserId: 'rewards-todoist-intruder'
    }).returning()

    try {
      await ensureUserDefaults(userA.id)
      await ensureUserDefaults(userB.id)

      const sessionA = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: userA.id })
      })
      const cookieA = sessionA.headers.get('set-cookie')?.split(';')[0] ?? ''

      const sessionB = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: userB.id })
      })
      const cookieB = sessionB.headers.get('set-cookie')?.split(';')[0] ?? ''

      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(cookieA) },
        body: JSON.stringify({ name: 'Mine', costPoints: 5 })
      })
      const rewardId = (await createRes.json()).data.id as string

      const patchRes = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(cookieB) },
        body: JSON.stringify({ name: 'Hacked' })
      })

      expect(patchRes.status).toBe(404)
    } finally {
      await db.delete(users).where(eq(users.id, userA.id))
      await db.delete(users).where(eq(users.id, userB.id))
    }
  })

  runIfDatabaseConfigured('PATCH empty body returns 422', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-empty@example.com',
      todoistUserId: 'rewards-todoist-empty'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'X', costPoints: 5 })
      })
      const rewardId = (await createRes.json()).data.id as string

      const res = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({})
      })
      const payload = await res.json()

      expect(res.status).toBe(422)
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('DELETE without redemption history returns 204', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-del@example.com',
      todoistUserId: 'rewards-todoist-del'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Temp', costPoints: 10 })
      })
      const rewardId = (await createRes.json()).data.id as string

      const delRes = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'DELETE',
        headers: authHeader(sessionCookie)
      })

      expect(delRes.status).toBe(204)

      const listRes = await fetch(`${baseUrl}/api/rewards`, {
        headers: authHeader(sessionCookie)
      })
      const listPayload = await listRes.json()

      expect(listPayload.data.meta.total).toBe(0)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('DELETE wrong user returns 404', async () => {
    const db = getDb()
    const [userA] = await db.insert(users).values({
      email: 'rewards-downer@example.com',
      todoistUserId: 'rewards-todoist-downer'
    }).returning()
    const [userB] = await db.insert(users).values({
      email: 'rewards-dintruder@example.com',
      todoistUserId: 'rewards-todoist-dintruder'
    }).returning()

    try {
      await ensureUserDefaults(userA.id)
      await ensureUserDefaults(userB.id)

      const sessionA = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: userA.id })
      })
      const cookieA = sessionA.headers.get('set-cookie')?.split(';')[0] ?? ''

      const sessionB = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: userB.id })
      })
      const cookieB = sessionB.headers.get('set-cookie')?.split(';')[0] ?? ''

      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(cookieA) },
        body: JSON.stringify({ name: 'Keep', costPoints: 5 })
      })
      const rewardId = (await createRes.json()).data.id as string

      const delRes = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'DELETE',
        headers: authHeader(cookieB)
      })

      expect(delRes.status).toBe(404)
    } finally {
      await db.delete(users).where(eq(users.id, userA.id))
      await db.delete(users).where(eq(users.id, userB.id))
    }
  })

  runIfDatabaseConfigured('GET /api/rewards/redemptions fresh user', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-red@example.com',
      todoistUserId: 'rewards-todoist-red'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/rewards/redemptions`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.redemptions).toEqual([])
      expect(payload.data.meta.total).toBe(0)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH archive hides reward from default list', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'rewards-arch@example.com',
      todoistUserId: 'rewards-todoist-arch'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const createRes = await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Old', costPoints: 15 })
      })
      const rewardId = (await createRes.json()).data.id as string

      const patchRes = await fetch(`${baseUrl}/api/rewards/${rewardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ isArchived: true })
      })
      expect(patchRes.status).toBe(200)
      const patchPayload = await patchRes.json()
      expect(patchPayload.data.isArchived).toBe(true)

      const listRes = await fetch(`${baseUrl}/api/rewards`, {
        headers: authHeader(sessionCookie)
      })
      const listPayload = await listRes.json()
      expect(listPayload.data.rewards).toHaveLength(0)

      const listArchivedRes = await fetch(`${baseUrl}/api/rewards?includeArchived=true`, {
        headers: authHeader(sessionCookie)
      })
      const archivedPayload = await listArchivedRes.json()
      expect(archivedPayload.data.rewards).toHaveLength(1)
      expect(archivedPayload.data.rewards[0].isArchived).toBe(true)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
