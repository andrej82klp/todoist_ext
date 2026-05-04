// Summary: Tests for task-related API endpoints and business logic.
// Verifies: task creation, retrieval, metadata updates, bulk operations, and validation edge cases.
// Requires: test DB (`DATABASE_URL`) for integration tests; seed data recommended for deterministic assertions.

import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import tasksListHandler from '../../server/api/tasks/index.get'
import taskDetailHandler from '../../server/api/tasks/[taskId]/index.get'
import taskMetadataPatchHandler from '../../server/api/tasks/[taskId]/metadata.patch'
import batchMetadataPatchHandler from '../../server/api/tasks/metadata/batch.patch'
import sessionPostHandler from '../../server/api/internal/test-auth/session.post'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { taskMetadata, users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'
import { itemMappingsRepository } from '../../server/repositories/item-mappings'
import {
  calculateEstimatedPoints,
  getDefaultPointsSettings,
  isDeadlineApproaching
} from '../../server/services/tasks/pointsCalculator'
import type { EnrichedTask, TaskSubtaskSummary } from '../../shared/types'

// Helper: toggles DB-backed integration tests when `DATABASE_URL` is provided.
const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

function authHeader(cookie: string) {
  return { cookie }
}

// Setup: boot local H3 server with session middleware and task-related routes.
// This allows tests to exercise request/response flows and middleware logic.
beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-7-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/internal/test-auth/session', sessionPostHandler)

  const router = createRouter()
  router.patch('/api/tasks/metadata/batch', batchMetadataPatchHandler)
  router.patch('/api/tasks/:taskId/metadata', taskMetadataPatchHandler)
  router.get('/api/tasks/:taskId', taskDetailHandler)
  router.get('/api/tasks', tasksListHandler)
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

describe('Milestone 7 — pointsCalculator unit tests', () => {
  it('calculates estimated points using default settings', () => {
    const settings = getDefaultPointsSettings()

    expect(calculateEstimatedPoints({ priority: 'low', difficulty: 5, customPointOverride: null }, settings)).toBe(50)
    expect(calculateEstimatedPoints({ priority: 'medium', difficulty: 5, customPointOverride: null }, settings)).toBe(63)
    expect(calculateEstimatedPoints({ priority: 'high', difficulty: 5, customPointOverride: null }, settings)).toBe(75)
  })

  it('uses customPointOverride when provided', () => {
    const settings = getDefaultPointsSettings()
    expect(calculateEstimatedPoints({ priority: 'medium', difficulty: 5, customPointOverride: 99 }, settings)).toBe(99)
  })

  it('isDeadlineApproaching returns true for past deadlines', () => {
    const past = new Date(Date.now() - 1000)
    expect(isDeadlineApproaching(past)).toBe(true)
  })

  it('isDeadlineApproaching returns true for deadlines within 2 days', () => {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000)
    expect(isDeadlineApproaching(soon)).toBe(true)
  })

  it('isDeadlineApproaching returns false for deadlines more than 2 days away', () => {
    const far = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    expect(isDeadlineApproaching(far)).toBe(false)
  })

  it('isDeadlineApproaching returns false for null deadline', () => {
    expect(isDeadlineApproaching(null)).toBe(false)
  })
})

describe('Milestone 7 — GET /api/tasks (unauthenticated)', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`)
    expect(res.status).toBe(401)
  })
})

describe('Milestone 7 — task list and metadata API', () => {
  runIfDatabaseConfigured('GET /api/tasks returns empty list when no tasks synced', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-empty@example.com',
      todoistUserId: 'tasks-todoist-empty'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data).toEqual([])
      expect(payload.meta.total).toBe(0)
      expect(payload.meta.page).toBe(1)
      expect(payload.meta.availableProjects).toEqual([])
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET /api/tasks returns enriched tasks with metadata defaults', async () => {
      // Test: batch metadata updates apply to multiple tasks and return updated mappings.
      const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-list@example.com',
      todoistUserId: 'tasks-todoist-list'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'proj-1', itemType: 'project', title: 'Work', projectTodoistId: null },
        { todoistItemId: 'task-1', itemType: 'task', title: 'Task One', projectTodoistId: 'proj-1', dueAt: null },
        { todoistItemId: 'task-2', itemType: 'task', title: 'Task Two', projectTodoistId: 'proj-1', dueAt: new Date(Date.now() + 1000) },
        { todoistItemId: 'sub-1', itemType: 'subtask', title: 'Subtask', parentTodoistItemId: 'task-1', projectTodoistId: 'proj-1' }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.meta.total).toBe(2)
      expect(payload.data).toHaveLength(2)

      const task1 = payload.data.find((t: EnrichedTask) => t.todoistTaskId === 'task-1')
      expect(task1).toBeTruthy()
      expect(task1.projectId).toBe('proj-1')
      expect(task1.projectName).toBe('Work')
      expect(task1.hasSubtasks).toBe(true)
      expect(task1.subtaskCount).toBe(1)
      expect(task1.completedSubtaskCount).toBe(0)
      expect(task1.progressPercent).toBe(0)
      expect(task1.eligibleForProgressTracking).toBe(true)
      expect(task1.metadata.priority).toBe('medium')
      expect(task1.metadata.difficulty).toBe(1)
      expect(task1.estimatedPoints).toBe(13)
      expect(task1.isCompleted).toBe(false)

      const task2 = payload.data.find((t: EnrichedTask) => t.todoistTaskId === 'task-2')
      expect(task2.hasSubtasks).toBe(false)
      expect(task2.progressPercent).toBeNull()
      expect(task2.eligibleForProgressTracking).toBe(false)
      expect(payload.meta.availableProjects).toEqual([
        {
          id: 'proj-1',
          name: 'Work'
        }
      ])
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET /api/tasks filters by projectId', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-filter@example.com',
      todoistUserId: 'tasks-todoist-filter'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'proj-a', itemType: 'project', title: 'Alpha' },
        { todoistItemId: 'proj-b', itemType: 'project', title: 'Beta' },
        { todoistItemId: 'task-a1', itemType: 'task', title: 'Alpha Task', projectTodoistId: 'proj-a' },
        { todoistItemId: 'task-b1', itemType: 'task', title: 'Beta Task', projectTodoistId: 'proj-b' }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks?projectId=proj-a`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.meta.total).toBe(1)
      expect(payload.data[0].todoistTaskId).toBe('task-a1')
      expect(payload.data[0].projectId).toBe('proj-a')
      expect(payload.meta.availableProjects).toEqual([
        {
          id: 'proj-a',
          name: 'Alpha'
        }
      ])
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET /api/tasks returns availableProjects from filtered dataset before pagination', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-project-options@example.com',
      todoistUserId: 'tasks-todoist-project-options'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'proj-z', itemType: 'project', title: 'Zeta' },
        { todoistItemId: 'proj-a', itemType: 'project', title: 'Alpha' },
        { todoistItemId: 'task-z1', itemType: 'task', title: 'Zeta Task', projectTodoistId: 'proj-z' },
        { todoistItemId: 'task-a1', itemType: 'task', title: 'Alpha Task', projectTodoistId: 'proj-a' }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks?page=1&pageSize=1`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data).toHaveLength(1)
      expect(payload.meta.total).toBe(2)
      expect(payload.meta.availableProjects).toEqual([
        {
          id: 'proj-a',
          name: 'Alpha'
        },
        {
          id: 'proj-z',
          name: 'Zeta'
        }
      ])
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET /api/tasks excludes completed tasks by default', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-completed@example.com',
      todoistUserId: 'tasks-todoist-completed'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'task-open', itemType: 'task', title: 'Open Task', isCompleted: false },
        { todoistItemId: 'task-done', itemType: 'task', title: 'Done Task', isCompleted: true }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const defaultRes = await fetch(`${baseUrl}/api/tasks`, {
        headers: authHeader(sessionCookie)
      })
      const defaultPayload = await defaultRes.json()
      expect(defaultPayload.meta.total).toBe(1)
      expect(defaultPayload.data[0].todoistTaskId).toBe('task-open')

      const allRes = await fetch(`${baseUrl}/api/tasks?includeCompleted=true`, {
        headers: authHeader(sessionCookie)
      })
      const allPayload = await allRes.json()
      expect(allPayload.meta.total).toBe(2)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET /api/tasks sorts by difficulty asc', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-sort@example.com',
      todoistUserId: 'tasks-todoist-sort'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const mappings = await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'task-hard', itemType: 'task', title: 'Hard Task' },
        { todoistItemId: 'task-easy', itemType: 'task', title: 'Easy Task' }
      ])

      const hardMapping = mappings.find(m => m.todoistItemId === 'task-hard')!
      const easyMapping = mappings.find(m => m.todoistItemId === 'task-easy')!

      await db.insert(taskMetadata).values([
        { userId: user.id, todoistItemMappingId: hardMapping.id, priority: 'high', difficulty: 8, completionBonusEnabled: true, completionBonusPercent: '10.00' },
        { userId: user.id, todoistItemMappingId: easyMapping.id, priority: 'low', difficulty: 2, completionBonusEnabled: true, completionBonusPercent: '10.00' }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks?sortBy=difficulty&sortOrder=asc`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data[0].todoistTaskId).toBe('task-easy')
      expect(payload.data[1].todoistTaskId).toBe('task-hard')
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET /api/tasks/:taskId returns task with subtasks', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-detail@example.com',
      todoistUserId: 'tasks-todoist-detail'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const mappings = await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'task-parent', itemType: 'task', title: 'Parent Task' },
        { todoistItemId: 'sub-a', itemType: 'subtask', title: 'Subtask A', parentTodoistItemId: 'task-parent', isCompleted: true },
        { todoistItemId: 'sub-b', itemType: 'subtask', title: 'Subtask B', parentTodoistItemId: 'task-parent', isCompleted: false }
      ])

      const parentMapping = mappings.find(m => m.todoistItemId === 'task-parent')!

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks/${parentMapping.id}`, {
        headers: authHeader(sessionCookie)
      })
      const payload = await res.json()

      expect(res.status).toBe(200)
      expect(payload.data.todoistTaskId).toBe('task-parent')
      expect(payload.data.subtasks).toHaveLength(2)
      expect(payload.data.subtaskCount).toBe(2)
      expect(payload.data.completedSubtaskCount).toBe(1)
      expect(payload.data.progressPercent).toBe(50)

      const subA = payload.data.subtasks.find((s: TaskSubtaskSummary) => s.todoistTaskId === 'sub-a')
      expect(subA.isCompleted).toBe(true)
      expect(subA.earnedPoints).toBeNull()
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('GET /api/tasks/:taskId returns 404 for unknown task', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-404@example.com',
      todoistUserId: 'tasks-todoist-404'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks/00000000-0000-0000-0000-000000000000`, {
        headers: authHeader(sessionCookie)
      })
      expect(res.status).toBe(404)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/tasks/:taskId/metadata creates and updates metadata', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-meta@example.com',
      todoistUserId: 'tasks-todoist-meta'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const [mapping] = await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'task-meta', itemType: 'task', title: 'Meta Task' }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const patchRes = await fetch(`${baseUrl}/api/tasks/${mapping!.id}/metadata`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({
          priority: 'high',
          difficulty: 7,
          timeEstimateMinutes: 60,
          completionBonusEnabled: true,
          completionBonusPercent: 15,
          badge: 'Deep Work',
          customPointOverride: null
        })
      })
      const patchPayload = await patchRes.json()

      expect(patchRes.status).toBe(200)
      expect(patchPayload.data.metadata.priority).toBe('high')
      expect(patchPayload.data.metadata.difficulty).toBe(7)
      expect(patchPayload.data.metadata.badge).toBe('Deep Work')

      const patchRes2 = await fetch(`${baseUrl}/api/tasks/${mapping!.id}/metadata`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({
          priority: 'low',
          difficulty: 3,
          timeEstimateMinutes: null,
          completionBonusEnabled: false,
          completionBonusPercent: 0,
          badge: null,
          customPointOverride: 50
        })
      })
      const patchPayload2 = await patchRes2.json()

      expect(patchRes2.status).toBe(200)
      expect(patchPayload2.data.metadata.priority).toBe('low')
      expect(patchPayload2.data.metadata.customPointOverride).toBe(50)

      const detailRes = await fetch(`${baseUrl}/api/tasks/${mapping!.id}`, {
        headers: authHeader(sessionCookie)
      })
      const detail = await detailRes.json()
      expect(detail.data.estimatedPoints).toBe(50)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/tasks/:taskId/metadata returns 422 for invalid payload', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-meta-invalid@example.com',
      todoistUserId: 'tasks-todoist-meta-invalid'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const [mapping] = await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'task-invalid', itemType: 'task', title: 'Invalid Meta Task' }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const res = await fetch(`${baseUrl}/api/tasks/${mapping!.id}/metadata`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({ priority: 'invalid', difficulty: 99 })
      })
      expect(res.status).toBe(422)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('PATCH /api/tasks/metadata/batch updates multiple tasks', async () => {
    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'tasks-batch@example.com',
      todoistUserId: 'tasks-todoist-batch'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const mappings = await itemMappingsRepository.upsertMany(user.id, [
        { todoistItemId: 'task-batch-1', itemType: 'task', title: 'Batch Task 1' },
        { todoistItemId: 'task-batch-2', itemType: 'task', title: 'Batch Task 2' }
      ])

      const sessionRes = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      })
      const sessionCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      const batchRes = await fetch(`${baseUrl}/api/tasks/metadata/batch`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeader(sessionCookie) },
        body: JSON.stringify({
          items: mappings.map(m => ({
            taskId: m.id,
            priority: 'medium',
            difficulty: 5,
            timeEstimateMinutes: null,
            completionBonusEnabled: true,
            completionBonusPercent: 10,
            badge: null,
            customPointOverride: null
          }))
        })
      })
      const batchPayload = await batchRes.json()

      expect(batchRes.status).toBe(200)
      expect(batchPayload.data.updated).toBe(2)
      expect(batchPayload.data.items).toHaveLength(2)
      expect(batchPayload.data.items.every((i: { success: boolean }) => i.success)).toBe(true)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
