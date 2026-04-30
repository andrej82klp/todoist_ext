import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import settingsGetHandler from '../../server/api/settings/index.get'
import settingsPatchHandler from '../../server/api/settings/index.patch'
import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
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
  process.env.SESSION_SECRET ||= 'milestone-8-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.get('/api/settings', settingsGetHandler)
  router.patch('/api/settings', settingsPatchHandler)
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

describe('Milestone 8 — GET /api/settings (unauthenticated)', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/settings`)
    expect(res.status).toBe(401)
  })
})

describe('Milestone 8 — PATCH /api/settings (unauthenticated)', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points: { difficultyMultiplierBase: 12 } })
    })
    expect(res.status).toBe(401)
  })
})

describe('Milestone 8 — settings API (authenticated)', () => {
  runIfDatabaseConfigured('GET /api/settings returns nested defaults', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'settings-get@example.com',
      todoistUserId: 'settings-todoist-get'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/settings`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.points.difficultyMultiplierBase).toBe(10)
      expect(payload.data.points.priorityMultipliers).toEqual({
        low: 1,
        medium: 1.25,
        high: 1.5
      })
      expect(payload.data.points.defaultCompletionBonusEnabled).toBe(true)
      expect(payload.data.points.defaultCompletionBonusPercent).toBe(10)
      expect(payload.data.streak.ruleType).toBe('completed_items')
      expect(payload.data.streak.ruleValue).toBe(1)
      expect(payload.data.streak.milestones.length).toBe(3)
      const days = payload.data.streak.milestones.map((m: { days: number }) => m.days).sort((a: number, b: number) => a - b)
      expect(days).toEqual([7, 14, 30])
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/settings persists points updates', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'settings-patch-points@example.com',
      todoistUserId: 'settings-todoist-patch-points'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const patchRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({
          points: {
            difficultyMultiplierBase: 25,
            priorityMultipliers: { low: 1.1, medium: 1.2, high: 1.3 }
          }
        })
      })
      const patchPayload = await patchRes.json()

      expect(patchRes.status).toBe(200)
      expect(patchPayload.data.success).toBe(true)
      expect(patchPayload.data.settings.points.difficultyMultiplierBase).toBe(25)
      expect(patchPayload.data.settings.points.priorityMultipliers.low).toBeCloseTo(1.1)
      expect(patchPayload.data.settings.points.priorityMultipliers.medium).toBeCloseTo(1.2)
      expect(patchPayload.data.settings.points.priorityMultipliers.high).toBeCloseTo(1.3)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/settings replaces streak milestones', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'settings-patch-milestones@example.com',
      todoistUserId: 'settings-todoist-patch-milestones'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const patchRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({
          streak: {
            milestones: [
              { days: 4, fixedBonusPoints: 11, percentageBonus: 1.5, isActive: true },
              { days: 9, fixedBonusPoints: 22, percentageBonus: 2.5, isActive: false }
            ]
          }
        })
      })
      const patchPayload = await patchRes.json()

      expect(patchRes.status).toBe(200)
      expect(patchPayload.data.settings.streak.milestones).toHaveLength(2)
      const byDays = Object.fromEntries(
        patchPayload.data.settings.streak.milestones.map((m: { days: number, fixedBonusPoints: number, percentageBonus: number, isActive: boolean }) => [m.days, m])
      )
      expect(byDays[4].fixedBonusPoints).toBe(11)
      expect(byDays[4].percentageBonus).toBeCloseTo(1.5)
      expect(byDays[9].isActive).toBe(false)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/settings with empty object returns 422', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'settings-empty@example.com',
      todoistUserId: 'settings-todoist-empty'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/settings`, {
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

  runIfDatabaseConfigured('PATCH /api/settings rejects invalid difficultyMultiplierBase', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'settings-invalid@example.com',
      todoistUserId: 'settings-todoist-invalid'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ points: { difficultyMultiplierBase: 0 } })
      })
      const payload = await res.json()

      expect(res.status).toBe(422)
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/settings rejects duplicate milestone days', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'settings-dup@example.com',
      todoistUserId: 'settings-todoist-dup'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({
          streak: {
            milestones: [
              { days: 5, fixedBonusPoints: 1, percentageBonus: 0, isActive: true },
              { days: 5, fixedBonusPoints: 2, percentageBonus: 0, isActive: true }
            ]
          }
        })
      })
      const payload = await res.json()

      expect(res.status).toBe(422)
      expect(payload.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
