import 'dotenv/config'

import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import dashboardGetHandler from '../../server/api/dashboard/index.get'
import settingsPatchHandler from '../../server/api/settings/index.patch'
import webhookPostHandler from '../../server/api/todoist/webhook.post'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import {
  dashboardNotifications,
  milestoneAwards,
  pointLedger,
  streakHistory,
  streakProtection,
  streakState,
  users
} from '../../server/db/schema'
import { itemMappingsRepository } from '../../server/repositories/item-mappings'
import { streaksRepository } from '../../server/repositories/streaks'
import { tasksRepository } from '../../server/repositories/tasks'
import sessionMiddleware from '../../server/middleware/session'

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

function signPayload(payload: string) {
  const secret = process.env.TODOIST_CLIENT_SECRET ?? 'milestone-14-test-client-secret'
  return createHmac('sha256', secret).update(payload).digest('base64')
}

async function sendWebhook(
  payload: Record<string, unknown>,
  options: { deliveryId: string, signature?: string }
) {
  const rawBody = JSON.stringify(payload)
  const signature = options.signature ?? signPayload(rawBody)

  const response = await fetch(`${baseUrl}/api/todoist/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-todoist-delivery-id': options.deliveryId,
      'x-todoist-hmac-sha256': signature
    },
    body: rawBody
  })

  return { response, payload: await response.json() }
}

async function sendDashboardRequest(sessionCookie: string) {
  const response = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie: sessionCookie }
  })
  return { response, payload: await response.json() }
}

async function patchSettings(sessionCookie: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'cookie': sessionCookie },
    body: JSON.stringify(body)
  })
  return { response, payload: await response.json() }
}

// Builds a full subtask-completion webhook payload for a given user / item
function completionPayload(
  todoistUserId: string,
  itemId: string,
  eventId: string,
  triggeredAt?: string
): Record<string, unknown> {
  return {
    event_name: 'item:completed',
    event_id: eventId,
    triggered_at: triggeredAt ?? new Date().toISOString(),
    event_data: {
      id: itemId,
      user_id: todoistUserId,
      checked: true
    }
  }
}

// ── Test fixtures ──────────────────────────────────────────────────────────────

interface TestUser {
  id: string
  todoistUserId: string
  sessionCookie: string
}

async function createTestUser(suffix: string): Promise<TestUser> {
  const db = getDb()
  const [user] = await db.insert(users).values({
    email: `streak-${suffix}@example.com`,
    todoistUserId: `streak-todoist-${suffix}`
  }).returning()

  await ensureUserDefaults(user.id)

  const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: user.id })
  })

  const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

  return { id: user.id, todoistUserId: user.todoistUserId, sessionCookie }
}

async function createSubtask(userId: string, todoistUserId: string, itemId: string) {
  const mappings = await itemMappingsRepository.upsertMany(userId, [
    { todoistItemId: `${itemId}-proj`, itemType: 'project', title: 'Test Project' },
    {
      todoistItemId: itemId,
      itemType: 'subtask',
      title: `Subtask ${itemId}`,
      projectTodoistId: `${itemId}-proj`,
      isCompleted: false
    }
  ])

  const subtaskMapping = mappings.find(m => m.todoistItemId === itemId)!
  await tasksRepository.upsertTaskMetadata(userId, subtaskMapping.id, {
    priority: 'medium',
    difficulty: 2,
    timeEstimateMinutes: null,
    completionBonusEnabled: false,
    completionBonusPercent: 0,
    badge: null,
    customPointOverride: null
  })

  return { subtaskMapping, todoistUserId }
}

// Directly set streak state for scenario setup
async function setStreakState(
  userId: string,
  opts: {
    currentStreak?: number
    longestStreak?: number
    lastEvaluatedDate?: string | null
    lastQualifiedDate?: string | null
    lastProtectionUsedDate?: string | null
  }
) {
  const db = getDb()
  await db.update(streakState)
    .set({
      ...(opts.currentStreak !== undefined && { currentStreak: opts.currentStreak }),
      ...(opts.longestStreak !== undefined && { longestStreak: opts.longestStreak }),
      ...(opts.lastEvaluatedDate !== undefined && { lastEvaluatedDate: opts.lastEvaluatedDate }),
      ...(opts.lastQualifiedDate !== undefined && { lastQualifiedDate: opts.lastQualifiedDate }),
      ...(opts.lastProtectionUsedDate !== undefined && { lastProtectionUsedDate: opts.lastProtectionUsedDate }),
      updatedAt: new Date()
    })
    .where(eq(streakState.userId, userId))
}

async function setProtection(userId: string, balance: number) {
  const db = getDb()
  await db.update(streakProtection)
    .set({ balance, updatedAt: new Date() })
    .where(eq(streakProtection.userId, userId))
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayUtc() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Server setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.TODOIST_CLIENT_SECRET ||= 'milestone-14-test-client-secret'
  process.env.SESSION_SECRET ||= 'milestone-14-test-session-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.get('/api/dashboard', dashboardGetHandler)
  router.patch('/api/settings', settingsPatchHandler)
  router.post('/api/todoist/webhook', webhookPostHandler)
  app.use(router)

  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  await closeDbConnection()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Milestone 14 — Streak engine (unauthenticated)', () => {
  it('GET /api/dashboard returns 401 for unauthenticated requests', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`)
    expect(response.status).toBe(401)
  })
})

describe('Milestone 14 — Streak engine (database)', () => {
  runIfDatabaseConfigured('first qualifying completion day creates streak=1', async () => {
    const db = getDb()
    const uid = `${Date.now()}-first-qual`
    const user = await createTestUser(uid)

    try {
      const today = todayUtc()
      await createSubtask(user.id, user.todoistUserId, `item-${uid}`)

      const result = await sendWebhook(
        completionPayload(user.todoistUserId, `item-${uid}`, `evt-${uid}`, `${today}T12:00:00Z`),
        { deliveryId: `del-${uid}` }
      )

      expect(result.response.status).toBe(200)

      const state = await streaksRepository.findStateByUserId(user.id)
      expect(state?.currentStreak).toBe(1)
      expect(state?.longestStreak).toBe(1)
      expect(state?.lastEvaluatedDate).toBe(today)
      expect(state?.lastQualifiedDate).toBe(today)

      const historyRow = await streaksRepository.findHistoryByUserIdAndDate(user.id, today)
      expect(historyRow?.qualified).toBe(true)
      expect(historyRow?.qualifiedBy).toBe('completed_items')
      expect(historyRow?.streakLength).toBe(1)
      expect(historyRow?.completedCount).toBe(1)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('second consecutive qualifying day increments streak to 2', async () => {
    const db = getDb()
    const uid = `${Date.now()}-two-day`
    const user = await createTestUser(uid)

    try {
      const today = todayUtc()
      const yesterday = yesterdayUtc()

      await createSubtask(user.id, user.todoistUserId, `item-${uid}-a`)
      await createSubtask(user.id, user.todoistUserId, `item-${uid}-b`)

      // Simulate yesterday's completion having been evaluated
      await setStreakState(user.id, {
        currentStreak: 1,
        longestStreak: 1,
        lastEvaluatedDate: yesterday,
        lastQualifiedDate: yesterday
      })

      // Today's completion via webhook
      await sendWebhook(
        completionPayload(user.todoistUserId, `item-${uid}-b`, `evt-${uid}-b`, `${today}T12:00:00Z`),
        { deliveryId: `del-${uid}-b` }
      )

      const state = await streaksRepository.findStateByUserId(user.id)
      expect(state?.currentStreak).toBe(2)
      expect(state?.longestStreak).toBe(2)
      expect(state?.lastEvaluatedDate).toBe(today)
      expect(state?.lastQualifiedDate).toBe(today)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('missed day with protection available preserves streak and creates notification', async () => {
    const db = getDb()
    const uid = `${Date.now()}-protect`
    const user = await createTestUser(uid)

    try {
      const twoDaysAgo = (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 2)
        return d.toISOString().slice(0, 10)
      })()

      // Set up streak with last evaluation being 2 days ago (yesterday missed)
      await setStreakState(user.id, {
        currentStreak: 5,
        longestStreak: 5,
        lastEvaluatedDate: twoDaysAgo,
        lastQualifiedDate: twoDaysAgo
      })
      await setProtection(user.id, 3)

      // Dashboard read triggers catch-up for the missed yesterday
      const dashResult = await sendDashboardRequest(user.sessionCookie)
      expect(dashResult.response.status).toBe(200)

      const state = await streaksRepository.findStateByUserId(user.id)
      const protection = await streaksRepository.findProtectionByUserId(user.id)
      const notifications = await db.select().from(dashboardNotifications)
        .where(eq(dashboardNotifications.userId, user.id))

      // Streak preserved (protection consumed)
      expect(state?.currentStreak).toBe(5)
      expect(protection?.balance).toBe(2)

      // One protection notification
      const protectionNotifs = notifications.filter(n => n.notificationType === 'streak_protection_used')
      expect(protectionNotifs).toHaveLength(1)
      expect(protectionNotifs[0]!.severity).toBe('warning')

      // Dashboard streak summary reflects protected streak
      expect(dashResult.payload.data.streak.current).toBe(5)
      expect(dashResult.payload.data.streak.protectionBalance).toBe(2)
      expect(dashResult.payload.data.notifications).toHaveLength(1)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('missed day with protection disabled resets streak to 0', async () => {
    const db = getDb()
    const uid = `${Date.now()}-no-protect`
    const user = await createTestUser(uid)

    try {
      // Disable protection via settings
      await patchSettings(user.sessionCookie, { streak: { protectionEnabled: false } })

      const twoDaysAgo = (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 2)
        return d.toISOString().slice(0, 10)
      })()

      await setStreakState(user.id, {
        currentStreak: 3,
        longestStreak: 3,
        lastEvaluatedDate: twoDaysAgo,
        lastQualifiedDate: twoDaysAgo
      })

      // Trigger catch-up
      await sendDashboardRequest(user.sessionCookie)

      const state = await streaksRepository.findStateByUserId(user.id)
      expect(state?.currentStreak).toBe(0)
      expect(state?.longestStreak).toBe(3) // longest never decreases

      const notifications = await db.select().from(dashboardNotifications)
        .where(eq(dashboardNotifications.userId, user.id))
      const protectionNotifs = notifications.filter(n => n.notificationType === 'streak_protection_used')
      expect(protectionNotifs).toHaveLength(0)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('missed day with zero protection balance resets streak to 0', async () => {
    const db = getDb()
    const uid = `${Date.now()}-zero-balance`
    const user = await createTestUser(uid)

    try {
      const twoDaysAgo = (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 2)
        return d.toISOString().slice(0, 10)
      })()

      await setStreakState(user.id, {
        currentStreak: 4,
        longestStreak: 4,
        lastEvaluatedDate: twoDaysAgo,
        lastQualifiedDate: twoDaysAgo
      })
      await setProtection(user.id, 0) // zero balance

      await sendDashboardRequest(user.sessionCookie)

      const state = await streaksRepository.findStateByUserId(user.id)
      expect(state?.currentStreak).toBe(0)
      expect(state?.longestStreak).toBe(4) // unchanged
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('protection notification is not duplicated for the same missed day', async () => {
    const db = getDb()
    const uid = `${Date.now()}-notif-dedup`
    const user = await createTestUser(uid)

    try {
      const twoDaysAgo = (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 2)
        return d.toISOString().slice(0, 10)
      })()

      await setStreakState(user.id, {
        currentStreak: 2,
        longestStreak: 2,
        lastEvaluatedDate: twoDaysAgo,
        lastQualifiedDate: twoDaysAgo
      })
      await setProtection(user.id, 3)

      // Two dashboard reads should not create two notifications
      await sendDashboardRequest(user.sessionCookie)
      await sendDashboardRequest(user.sessionCookie)

      const notifications = await db.select().from(dashboardNotifications)
        .where(eq(dashboardNotifications.userId, user.id))
      const protectionNotifs = notifications.filter(n => n.notificationType === 'streak_protection_used')
      expect(protectionNotifs).toHaveLength(1)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('7-day fixed milestone awards bonus points and ledger row exactly once', async () => {
    const db = getDb()
    const uid = `${Date.now()}-milestone`
    const user = await createTestUser(uid)

    try {
      const today = todayUtc()

      // Configure milestone at 7 days with 100 fixed bonus points
      await patchSettings(user.sessionCookie, {
        streak: {
          milestones: [{ days: 7, fixedBonusPoints: 100, percentageBonus: 0, isActive: true }]
        }
      })

      // Set up streak at 6, so reaching 7 today triggers the milestone
      await setStreakState(user.id, {
        currentStreak: 6,
        longestStreak: 6,
        lastEvaluatedDate: yesterdayUtc(),
        lastQualifiedDate: yesterdayUtc()
      })

      await createSubtask(user.id, user.todoistUserId, `item-ms-${uid}`)

      await sendWebhook(
        completionPayload(user.todoistUserId, `item-ms-${uid}`, `evt-ms-${uid}`, `${today}T10:00:00Z`),
        { deliveryId: `del-ms-${uid}` }
      )

      const state = await streaksRepository.findStateByUserId(user.id)
      expect(state?.currentStreak).toBe(7)

      const ledgerRows = await db.select().from(pointLedger)
        .where(eq(pointLedger.userId, user.id))
      const bonusRows = ledgerRows.filter(r => r.transactionType === 'bonus' && r.source === 'streak_milestone')
      expect(bonusRows).toHaveLength(1)
      expect(bonusRows[0]!.amount).toBe(100)

      const awards = await db.select().from(milestoneAwards)
        .where(eq(milestoneAwards.userId, user.id))
      expect(awards).toHaveLength(1)
      expect(awards[0]!.awardedForDays).toBe(7)

      // Second webhook for same completion should not duplicate the award
      await createSubtask(user.id, user.todoistUserId, `item-ms2-${uid}`)
      await sendWebhook(
        completionPayload(user.todoistUserId, `item-ms2-${uid}`, `evt-ms2-${uid}`, `${today}T11:00:00Z`),
        { deliveryId: `del-ms2-${uid}` }
      )

      const awardsAfter = await db.select().from(milestoneAwards)
        .where(eq(milestoneAwards.userId, user.id))
      expect(awardsAfter).toHaveLength(1) // no duplicate

      const bonusAfter = ledgerRows.filter(r => r.transactionType === 'bonus' && r.source === 'streak_milestone')
      expect(bonusAfter).toHaveLength(1) // no duplicate ledger row
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('duplicate webhook delivery does not double-advance streak', async () => {
    const db = getDb()
    const uid = `${Date.now()}-dup-wh`
    const user = await createTestUser(uid)

    try {
      const today = todayUtc()
      await createSubtask(user.id, user.todoistUserId, `item-dup-${uid}`)

      const webhookPayload = completionPayload(
        user.todoistUserId,
        `item-dup-${uid}`,
        `evt-dup-${uid}`,
        `${today}T09:00:00Z`
      )

      // Send same event twice with the same delivery ID (Todoist retries same delivery)
      await sendWebhook(webhookPayload, { deliveryId: `del-dup-${uid}` })
      await sendWebhook(webhookPayload, { deliveryId: `del-dup-${uid}` })

      const state = await streaksRepository.findStateByUserId(user.id)
      expect(state?.currentStreak).toBe(1) // advanced exactly once

      const historyRows = await db.select().from(streakHistory)
        .where(eq(streakHistory.userId, user.id))
      expect(historyRows).toHaveLength(1) // one row per day
      expect(historyRows[0]!.completedCount).toBe(1) // only one completion counted
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('points rule qualifies only when earned points meet threshold', async () => {
    const db = getDb()
    const uid = `${Date.now()}-pts-rule`
    const user = await createTestUser(uid)

    try {
      const today = todayUtc()

      // Configure points rule: need 100 points per day
      await patchSettings(user.sessionCookie, {
        streak: { ruleType: 'points', ruleValue: 100 }
      })

      // Subtask with difficulty=2, medium priority: 2*10 * 1.25 = 25 points — not enough
      await createSubtask(user.id, user.todoistUserId, `item-pts-${uid}`)
      await sendWebhook(
        completionPayload(user.todoistUserId, `item-pts-${uid}`, `evt-pts-${uid}`, `${today}T08:00:00Z`),
        { deliveryId: `del-pts-${uid}` }
      )

      const state = await streaksRepository.findStateByUserId(user.id)
      expect(state?.currentStreak).toBe(0) // did not qualify
      expect(state?.lastQualifiedDate).toBeNull()

      const historyRow = await streaksRepository.findHistoryByUserIdAndDate(user.id, today)
      expect(historyRow?.qualified).toBe(false)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('dashboard catch-up evaluates multiple missed days in sequence', async () => {
    const db = getDb()
    const uid = `${Date.now()}-multi-miss`
    const user = await createTestUser(uid)

    try {
      const threeDaysAgo = (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 3)
        return d.toISOString().slice(0, 10)
      })()

      // Start with streak of 10, last evaluated 3 days ago
      await setStreakState(user.id, {
        currentStreak: 10,
        longestStreak: 10,
        lastEvaluatedDate: threeDaysAgo,
        lastQualifiedDate: threeDaysAgo
      })
      await setProtection(user.id, 2) // can protect 2 of the 2 missed days

      await sendDashboardRequest(user.sessionCookie)

      const state = await streaksRepository.findStateByUserId(user.id)
      const protection = await streaksRepository.findProtectionByUserId(user.id)

      // 2 missed days evaluated, both protected (2 protection days consumed)
      expect(state?.currentStreak).toBe(10) // preserved
      expect(protection?.balance).toBe(0)

      const notifications = await db.select().from(dashboardNotifications)
        .where(eq(dashboardNotifications.userId, user.id))
      const protectionNotifs = notifications.filter(n => n.notificationType === 'streak_protection_used')
      expect(protectionNotifs).toHaveLength(2) // one per protected day
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('protection reward increments balance when streak hits multiple of N', async () => {
    const db = getDb()
    const uid = `${Date.now()}-prot-reward`
    const user = await createTestUser(uid)

    try {
      const today = todayUtc()

      // Configure protection reward every 3 days for easy testing
      await patchSettings(user.sessionCookie, {
        streak: { protectionRewardEveryNDays: 3, protectionRewardAmount: 1 }
      })

      // Set streak to 2 so completing today brings it to 3 (a reward boundary)
      await setStreakState(user.id, {
        currentStreak: 2,
        longestStreak: 2,
        lastEvaluatedDate: yesterdayUtc(),
        lastQualifiedDate: yesterdayUtc()
      })
      await setProtection(user.id, 1)

      await createSubtask(user.id, user.todoistUserId, `item-pr-${uid}`)
      await sendWebhook(
        completionPayload(user.todoistUserId, `item-pr-${uid}`, `evt-pr-${uid}`, `${today}T12:00:00Z`),
        { deliveryId: `del-pr-${uid}` }
      )

      const state = await streaksRepository.findStateByUserId(user.id)
      const protection = await streaksRepository.findProtectionByUserId(user.id)

      expect(state?.currentStreak).toBe(3)
      expect(protection?.balance).toBe(2) // 1 existing + 1 reward
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
