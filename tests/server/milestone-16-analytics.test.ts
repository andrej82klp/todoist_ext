import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import analyticsSummaryGetHandler from '../../server/api/analytics/summary.get'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { milestoneAwards, milestoneDefinitions, pointLedger, users } from '../../server/db/schema'
import { itemMappingsRepository } from '../../server/repositories/item-mappings'
import { streaksRepository } from '../../server/repositories/streaks'
import sessionMiddleware from '../../server/middleware/session'

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-16-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.get('/api/analytics/summary', analyticsSummaryGetHandler)
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

// ── Helper ─────────────────────────────────────────────────────────────────────

async function createTestUser(suffix: string) {
  const db = getDb()
  const [user] = await db
    .insert(users)
    .values({ email: `analytics-${suffix}@example.com`, todoistUserId: `analytics-todoist-${suffix}` })
    .returning()

  await ensureUserDefaults(user.id)

  const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: user.id })
  })
  const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

  return { user, sessionCookie }
}

async function seedLedgerRow(
  userId: string,
  opts: {
    source: string
    transactionType: 'earned' | 'bonus' | 'spent' | 'adjusted'
    amount: number
    relatedEntityId: string
    idempotencyKey?: string
  }
) {
  const db = getDb()
  const [row] = await db
    .insert(pointLedger)
    .values({
      userId,
      transactionType: opts.transactionType,
      amount: opts.amount,
      description: `Test ledger row (${opts.source})`,
      source: opts.source,
      relatedEntityType: 'subtask',
      relatedEntityId: opts.relatedEntityId,
      idempotencyKey: opts.idempotencyKey ?? null
    })
    .returning()
  return row!
}

// ── Unauthenticated ───────────────────────────────────────────────────────────

describe('Milestone 16 — GET /api/analytics/summary (unauthenticated)', () => {
  it('returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/summary`)
    expect(res.status).toBe(401)
  })
})

// ── Authenticated ─────────────────────────────────────────────────────────────

describe('Milestone 16 — analytics summary API (authenticated)', () => {
  runIfDatabaseConfigured('returns empty state for a fresh user', async () => {
    const { user, sessionCookie } = await createTestUser('empty')

    try {
      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects).toEqual([])
      expect(payload.data.streakHistory.current).toBe(0)
      expect(payload.data.streakHistory.longest).toBe(0)
      expect(payload.data.streakHistory.milestonesReached).toEqual([])
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('aggregates earned points across multiple rows for the same project', async () => {
    const { user, sessionCookie } = await createTestUser('agg')

    try {
      // Project and two subtasks in the same project
      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'proj-agg', itemType: 'project', title: 'Agg Project' },
        { todoistItemId: 'subtask-agg-1', itemType: 'subtask', title: 'Sub 1', projectTodoistId: 'proj-agg' },
        { todoistItemId: 'subtask-agg-2', itemType: 'subtask', title: 'Sub 2', projectTodoistId: 'proj-agg' }
      ])

      await seedLedgerRow(user.id, {
        source: 'todoist_webhook_subtask_completion',
        transactionType: 'earned',
        amount: 30,
        relatedEntityId: 'subtask-agg-1',
        idempotencyKey: `agg-sub1-${user.id}`
      })
      await seedLedgerRow(user.id, {
        source: 'todoist_webhook_subtask_completion',
        transactionType: 'earned',
        amount: 20,
        relatedEntityId: 'subtask-agg-2',
        idempotencyKey: `agg-sub2-${user.id}`
      })

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects).toHaveLength(1)
      expect(payload.data.mostRewardingProjects[0].projectName).toBe('Agg Project')
      expect(payload.data.mostRewardingProjects[0].pointsEarned).toBe(50)
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('includes task completion bonus rows in project totals', async () => {
    const { user, sessionCookie } = await createTestUser('bonus')

    try {
      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'proj-bonus', itemType: 'project', title: 'Bonus Project' },
        { todoistItemId: 'task-bonus', itemType: 'task', title: 'Parent Task', projectTodoistId: 'proj-bonus' }
      ])

      await seedLedgerRow(user.id, {
        source: 'todoist_webhook_task_completion_bonus',
        transactionType: 'bonus',
        amount: 15,
        relatedEntityId: 'task-bonus',
        idempotencyKey: `bonus-task-${user.id}`
      })

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects).toHaveLength(1)
      expect(payload.data.mostRewardingProjects[0].pointsEarned).toBe(15)
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('excludes spent, adjusted, and streak bonus rows from project totals', async () => {
    const { user, sessionCookie } = await createTestUser('excl')

    try {
      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'proj-excl', itemType: 'project', title: 'Excl Project' },
        { todoistItemId: 'subtask-excl', itemType: 'subtask', title: 'Sub', projectTodoistId: 'proj-excl' }
      ])

      // This one should be counted
      await seedLedgerRow(user.id, {
        source: 'todoist_webhook_subtask_completion',
        transactionType: 'earned',
        amount: 10,
        relatedEntityId: 'subtask-excl',
        idempotencyKey: `excl-earned-${user.id}`
      })
      // These should NOT be counted
      await seedLedgerRow(user.id, {
        source: 'manual_adjustment',
        transactionType: 'adjusted',
        amount: 500,
        relatedEntityId: 'subtask-excl',
        idempotencyKey: `excl-adj-${user.id}`
      })
      await seedLedgerRow(user.id, {
        source: 'streak_milestone',
        transactionType: 'bonus',
        amount: 200,
        relatedEntityId: 'subtask-excl',
        idempotencyKey: `excl-streak-${user.id}`
      })

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects).toHaveLength(1)
      expect(payload.data.mostRewardingProjects[0].pointsEarned).toBe(10)
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('orders multiple projects by points descending', async () => {
    const { user, sessionCookie } = await createTestUser('order')

    try {
      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'proj-ord-a', itemType: 'project', title: 'Project A' },
        { todoistItemId: 'proj-ord-b', itemType: 'project', title: 'Project B' },
        { todoistItemId: 'subtask-ord-a', itemType: 'subtask', title: 'Sub A', projectTodoistId: 'proj-ord-a' },
        { todoistItemId: 'subtask-ord-b', itemType: 'subtask', title: 'Sub B', projectTodoistId: 'proj-ord-b' }
      ])

      // Project B should come first (higher points)
      await seedLedgerRow(user.id, {
        source: 'todoist_webhook_subtask_completion',
        transactionType: 'earned',
        amount: 20,
        relatedEntityId: 'subtask-ord-a',
        idempotencyKey: `ord-a-${user.id}`
      })
      await seedLedgerRow(user.id, {
        source: 'todoist_webhook_subtask_completion',
        transactionType: 'earned',
        amount: 50,
        relatedEntityId: 'subtask-ord-b',
        idempotencyKey: `ord-b-${user.id}`
      })

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects[0].projectName).toBe('Project B')
      expect(payload.data.mostRewardingProjects[0].pointsEarned).toBe(50)
      expect(payload.data.mostRewardingProjects[1].projectName).toBe('Project A')
      expect(payload.data.mostRewardingProjects[1].pointsEarned).toBe(20)
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('caps project results to 5 entries', async () => {
    const { user, sessionCookie } = await createTestUser('cap')

    try {
      const projects = Array.from({ length: 7 }, (_, i) => ({
        todoistItemId: `proj-cap-${i}`,
        itemType: 'project' as const,
        title: `Cap Project ${i}`
      }))
      const subtasks = Array.from({ length: 7 }, (_, i) => ({
        todoistItemId: `subtask-cap-${i}`,
        itemType: 'subtask' as const,
        title: `Cap Sub ${i}`,
        projectTodoistId: `proj-cap-${i}`
      }))
      await itemMappingsRepository.upsertMany(user.id, [...projects, ...subtasks])

      for (let i = 0; i < 7; i++) {
        await seedLedgerRow(user.id, {
          source: 'todoist_webhook_subtask_completion',
          transactionType: 'earned',
          amount: (i + 1) * 10,
          relatedEntityId: `subtask-cap-${i}`,
          idempotencyKey: `cap-sub-${i}-${user.id}`
        })
      }

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects.length).toBeLessThanOrEqual(5)
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('returns streak state correctly', async () => {
    const { user, sessionCookie } = await createTestUser('streak')

    try {
      await streaksRepository.updateStateInTransaction(
        // Pass the raw DB client; in non-transaction tests, pass through the tx-compatible API
        getDb() as unknown as Parameters<typeof streaksRepository.updateStateInTransaction>[0],
        user.id,
        { currentStreak: 7, longestStreak: 14 }
      )

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.streakHistory.current).toBe(7)
      expect(payload.data.streakHistory.longest).toBe(14)
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('returns milestone awards as sorted milestonesReached array', async () => {
    const { user, sessionCookie } = await createTestUser('miles')

    try {
      const db = getDb()

      // Trigger ensureDefaults so milestone definitions exist for days 7, 14, 30.
      await fetch(`${baseUrl}/api/analytics/summary`, { headers: { cookie: sessionCookie } })

      // Look up the definitions that ensureDefaults created.
      const defs = await db
        .select()
        .from(milestoneDefinitions)
        .where(eq(milestoneDefinitions.userId, user.id))

      const def7 = defs.find(d => d.days === 7)
      const def14 = defs.find(d => d.days === 14)
      if (!def7 || !def14) throw new Error('Expected default milestone definitions to exist')

      // Insert awards out-of-order to verify sorting.
      await db.insert(milestoneAwards).values([
        { userId: user.id, milestoneDefinitionId: def14.id, awardedForDays: 14, ledgerTransactionId: null },
        { userId: user.id, milestoneDefinitionId: def7.id, awardedForDays: 7, ledgerTransactionId: null }
      ])

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.streakHistory.milestonesReached).toEqual([7, 14])
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('does not leak data across users', async () => {
    const { user: userA, sessionCookie: cookieA } = await createTestUser('scopeA')
    const { user: userB } = await createTestUser('scopeB')

    try {
      // Plant data only for user B
      await itemMappingsRepository.upsertMany(userB.id, [
        { todoistItemId: 'proj-scope-b', itemType: 'project', title: 'B Project' },
        { todoistItemId: 'subtask-scope-b', itemType: 'subtask', title: 'B Sub', projectTodoistId: 'proj-scope-b' }
      ])
      await seedLedgerRow(userB.id, {
        source: 'todoist_webhook_subtask_completion',
        transactionType: 'earned',
        amount: 999,
        relatedEntityId: 'subtask-scope-b',
        idempotencyKey: `scope-b-${userB.id}`
      })

      // User A should see no projects
      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: cookieA }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects).toEqual([])
    } finally {
      await getDb().delete(users).where(eq(users.id, userA.id))
      await getDb().delete(users).where(eq(users.id, userB.id))
    }
  })

  runIfDatabaseConfigured('returns fallback project name when project mapping is missing', async () => {
    const { user, sessionCookie } = await createTestUser('fallback')

    try {
      // Insert only the subtask mapping, no project mapping
      await itemMappingsRepository.upsertMany(user.id, [
        {
          todoistItemId: 'subtask-fallback',
          itemType: 'subtask',
          title: 'Orphaned Sub',
          projectTodoistId: 'proj-no-mapping'
        }
      ])

      await seedLedgerRow(user.id, {
        source: 'todoist_webhook_subtask_completion',
        transactionType: 'earned',
        amount: 25,
        relatedEntityId: 'subtask-fallback',
        idempotencyKey: `fallback-sub-${user.id}`
      })

      const res = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { cookie: sessionCookie }
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.mostRewardingProjects).toHaveLength(1)
      expect(payload.data.mostRewardingProjects[0].projectId).toBe('proj-no-mapping')
      expect(payload.data.mostRewardingProjects[0].projectName).toBe('Unknown project')
      expect(payload.data.mostRewardingProjects[0].pointsEarned).toBe(25)
    } finally {
      await getDb().delete(users).where(eq(users.id, user.id))
    }
  })
})
