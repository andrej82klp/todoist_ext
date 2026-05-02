import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import dashboardGetHandler from '../../server/api/dashboard/index.get'
import dashboardAcknowledgePostHandler from '../../server/api/dashboard/notifications/[notificationId]/acknowledge.post'
import ledgerAdjustmentsPostHandler from '../../server/api/ledger/adjustments.post'
import rewardsPostHandler from '../../server/api/rewards/index.post'
import settingsPatchHandler from '../../server/api/settings/index.patch'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { dashboardNotifications, streakProtection, streakState, users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'
import { tasksRepository } from '../../server/repositories/tasks'

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

async function createTask(sessionCookie: string, userId: string, input: {
  todoistItemId: string
  title: string
  dueAt?: Date | null
  isCompleted?: boolean
  priority?: 'low' | 'medium' | 'high'
  difficulty?: number
  timeEstimateMinutes?: number | null
}) {
  const db = getDb()
  const [mapping] = await db.insert((await import('../../server/db/schema')).todoistItemMappings).values({
    userId,
    todoistItemId: input.todoistItemId,
    itemType: 'task',
    title: input.title,
    projectTodoistId: null,
    parentTodoistItemId: null,
    dueAt: input.dueAt ?? null,
    isCompleted: input.isCompleted ?? false,
    rawPayload: {}
  }).returning()

  await tasksRepository.upsertTaskMetadata(userId, mapping.id, {
    priority: input.priority ?? 'medium',
    difficulty: input.difficulty ?? 1,
    timeEstimateMinutes: input.timeEstimateMinutes ?? null,
    completionBonusEnabled: true,
    completionBonusPercent: 10,
    badge: null,
    customPointOverride: null
  })

  return mapping
}

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-12-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.get('/api/dashboard', dashboardGetHandler)
  router.post('/api/dashboard/notifications/:notificationId/acknowledge', dashboardAcknowledgePostHandler)
  router.post('/api/ledger/adjustments', ledgerAdjustmentsPostHandler)
  router.post('/api/rewards', rewardsPostHandler)
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

describe('Milestone 12 — dashboard API (unauthenticated)', () => {
  it('GET /api/dashboard returns 401', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`)
    expect(response.status).toBe(401)
  })

  it('POST /api/dashboard/notifications/:notificationId/acknowledge returns 401', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard/notifications/test/acknowledge`, {
      method: 'POST'
    })

    expect(response.status).toBe(401)
  })
})

describe('Milestone 12 — dashboard API (authenticated)', () => {
  runIfDatabaseConfigured('returns an empty dashboard for a fresh user', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('dashboard-empty')

    try {
      const response = await fetch(`${baseUrl}/api/dashboard`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.data.points).toEqual({
        currentBalance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      })
      expect(payload.data.streak).toEqual({
        current: 0,
        longest: 0,
        protectionBalance: 3,
        ruleType: 'completed_items',
        ruleValue: 1,
        nextMilestone: {
          days: 7,
          remainingDays: 7
        }
      })
      expect(payload.data.todayTasks).toEqual([])
      expect(payload.data.recentTransactions).toEqual([])
      expect(payload.data.rewardProgress).toEqual({ closestReward: null })
      expect(payload.data.notifications).toEqual([])
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('aggregates populated dashboard data and filters today tasks', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('dashboard-full')

    try {
      await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({
          streak: {
            milestones: [
              { days: 2, fixedBonusPoints: 10, percentageBonus: 0, isActive: true },
              { days: 7, fixedBonusPoints: 30, percentageBonus: 0, isActive: true }
            ]
          }
        })
      })

      await db.update(streakState).set({
        currentStreak: 1,
        longestStreak: 4,
        updatedAt: new Date()
      }).where(eq(streakState.userId, user.id))

      await db.update(streakProtection).set({
        balance: 2,
        updatedAt: new Date()
      }).where(eq(streakProtection.userId, user.id))

      await fetch(`${baseUrl}/api/ledger/adjustments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ amount: 120, reason: 'seed points' })
      })

      await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Cinema Night', costPoints: 150 })
      })

      await fetch(`${baseUrl}/api/rewards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ name: 'Coffee Break', costPoints: 90 })
      })

      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      const yesterday = new Date(today)
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)

      await createTask(sessionCookie, user.id, {
        todoistItemId: 'task-today-high',
        title: 'Due today and important',
        dueAt: today,
        priority: 'high',
        difficulty: 4,
        timeEstimateMinutes: 60
      })

      await createTask(sessionCookie, user.id, {
        todoistItemId: 'task-overdue-medium',
        title: 'Overdue work',
        dueAt: yesterday,
        priority: 'medium',
        difficulty: 2,
        timeEstimateMinutes: 20
      })

      await createTask(sessionCookie, user.id, {
        todoistItemId: 'task-future',
        title: 'Future task',
        dueAt: tomorrow,
        priority: 'high',
        difficulty: 5,
        timeEstimateMinutes: 30
      })

      await db.insert(dashboardNotifications).values({
        userId: user.id,
        notificationType: 'streak_protection_used',
        severity: 'warning',
        title: 'Protection used',
        message: 'Your streak was protected yesterday.',
        payload: {}
      })

      await db.insert(dashboardNotifications).values({
        userId: user.id,
        notificationType: 'system',
        severity: 'info',
        title: 'Old notice',
        message: 'Already acknowledged',
        payload: {},
        acknowledgedAt: new Date()
      })

      const response = await fetch(`${baseUrl}/api/dashboard`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.data.points).toEqual({
        currentBalance: 120,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      })
      expect(payload.data.streak).toEqual({
        current: 1,
        longest: 4,
        protectionBalance: 2,
        ruleType: 'completed_items',
        ruleValue: 1,
        nextMilestone: {
          days: 2,
          remainingDays: 1
        }
      })
      expect(payload.data.todayTasks).toHaveLength(2)
      expect(payload.data.todayTasks.map((task: { title: string }) => task.title)).toEqual([
        'Overdue work',
        'Due today and important'
      ])
      expect(payload.data.recentTransactions).toHaveLength(1)
      expect(payload.data.rewardProgress).toEqual({
        closestReward: {
          id: expect.any(String),
          name: 'Coffee Break',
          costPoints: 90,
          pointsNeeded: 0
        }
      })
      expect(payload.data.notifications).toHaveLength(1)
      expect(payload.data.notifications[0]).toMatchObject({
        type: 'streak_protection_used',
        severity: 'warning',
        requiresAcknowledgement: true
      })
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('acknowledges a notification and removes it from the dashboard', async () => {
    const db = getDb()
    const { user, sessionCookie } = await createAuthedUser('dashboard-ack')

    try {
      const [notification] = await db.insert(dashboardNotifications).values({
        userId: user.id,
        notificationType: 'system',
        severity: 'info',
        title: 'Dismiss me',
        message: 'This should disappear after acknowledgement.',
        payload: {}
      }).returning()

      const acknowledgeResponse = await fetch(`${baseUrl}/api/dashboard/notifications/${notification.id}/acknowledge`, {
        method: 'POST',
        headers: authHeader(sessionCookie)
      })
      const acknowledgePayload = await acknowledgeResponse.json()

      expect(acknowledgeResponse.status).toBe(200)
      expect(acknowledgePayload.data).toEqual({
        success: true,
        notificationId: notification.id
      })

      const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
        headers: authHeader(sessionCookie)
      })
      const dashboardPayload = await dashboardResponse.json()

      expect(dashboardPayload.data.notifications).toEqual([])
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('returns 404 when acknowledging another user\'s notification', async () => {
    const db = getDb()
    const owner = await createAuthedUser('dashboard-owner')
    const intruder = await createAuthedUser('dashboard-intruder')

    try {
      const [notification] = await db.insert(dashboardNotifications).values({
        userId: owner.user.id,
        notificationType: 'system',
        severity: 'info',
        title: 'Private',
        message: 'Owner only',
        payload: {}
      }).returning()

      const response = await fetch(`${baseUrl}/api/dashboard/notifications/${notification.id}/acknowledge`, {
        method: 'POST',
        headers: authHeader(intruder.sessionCookie)
      })
      const payload = await response.json()

      expect(response.status).toBe(404)
      expect(payload.error.code).toBe('NOT_FOUND')
    } finally {
      await db.delete(users).where(eq(users.id, owner.user.id))
      await db.delete(users).where(eq(users.id, intruder.user.id))
    }
  })
})
