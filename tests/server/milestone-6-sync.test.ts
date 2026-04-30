import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import sessionHandler from '../../server/api/auth/session.get'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'
import { itemMappingsRepository } from '../../server/repositories/item-mappings'
import { fetchAllTodoistProjects, fetchAllTodoistTasks } from '../../server/services/todoist/sync'
import { todoistSyncService } from '../../server/services/todoist/todoistSyncService'

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

const MOCK_PROJECTS = [
  { id: 'proj-1', name: 'Inbox', parent_id: null },
  { id: 'proj-2', name: 'Work', parent_id: null },
  { id: 'proj-3', name: 'Sub-Work', parent_id: 'proj-2' }
]

const MOCK_TASKS = [
  {
    id: 'task-1',
    content: 'Buy Milk',
    project_id: 'proj-1',
    parent_id: null,
    due: null,
    checked: false,
    is_deleted: false
  },
  {
    id: 'task-2',
    content: 'Root task with due date',
    project_id: 'proj-2',
    parent_id: null,
    due: { date: '2026-05-01', datetime: null },
    checked: false,
    is_deleted: false
  },
  {
    id: 'task-3',
    content: 'Subtask of task-2',
    project_id: 'proj-2',
    parent_id: 'task-2',
    due: null,
    checked: false,
    is_deleted: false
  },
  {
    id: 'task-4',
    content: 'Deleted task (should be excluded)',
    project_id: 'proj-1',
    parent_id: null,
    due: null,
    checked: false,
    is_deleted: true
  }
]

function makeFetchMock(page2Projects = false) {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url

    if (url.startsWith('https://api.todoist.com/api/v1/projects')) {
      const urlObj = new URL(url)
      const cursor = urlObj.searchParams.get('cursor')

      if (page2Projects && !cursor) {
        return new Response(JSON.stringify({
          results: [MOCK_PROJECTS[0], MOCK_PROJECTS[1]],
          next_cursor: 'page2-cursor'
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      if (page2Projects && cursor === 'page2-cursor') {
        return new Response(JSON.stringify({
          results: [MOCK_PROJECTS[2]],
          next_cursor: null
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      return new Response(JSON.stringify({
        results: MOCK_PROJECTS,
        next_cursor: null
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url.startsWith('https://api.todoist.com/api/v1/tasks')) {
      return new Response(JSON.stringify({
        results: MOCK_TASKS,
        next_cursor: null
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    throw new Error(`Unexpected fetch to: ${url}`)
  }
}

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-6-test-secret'

  const app = createApp()
  app.use(sessionMiddleware)
  app.use('/api/auth/session', sessionHandler)

  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  await closeDbConnection()
})

describe('Milestone 6 — Todoist sync API client', () => {
  it('fetches projects from the Todoist API', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock() as typeof fetch

    try {
      const projects = await fetchAllTodoistProjects('test-token')
      expect(projects).toHaveLength(3)
      expect(projects[0]).toMatchObject({ id: 'proj-1', name: 'Inbox' })
      expect(projects[1]).toMatchObject({ id: 'proj-2', name: 'Work' })
      expect(projects[2]).toMatchObject({ id: 'proj-3', name: 'Sub-Work', parent_id: 'proj-2' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetches all projects across multiple pages', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(true) as typeof fetch

    try {
      const projects = await fetchAllTodoistProjects('test-token')
      expect(projects).toHaveLength(3)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetches active tasks and filters out deleted tasks', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock() as typeof fetch

    try {
      const tasks = await fetchAllTodoistTasks('test-token')
      expect(tasks).toHaveLength(3)
      expect(tasks.find(t => t.id === 'task-4')).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('throws when Todoist API returns a non-2xx response', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('Unauthorized', {
      status: 401,
      statusText: 'Unauthorized'
    }) as Response

    try {
      await expect(fetchAllTodoistProjects('bad-token')).rejects.toMatchObject({
        name: 'ApiHttpError',
        statusCode: 500
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('Milestone 6 — todoistSyncService.runInitialSync', () => {
  runIfDatabaseConfigured('persists projects, tasks, and subtasks to the database', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock() as typeof fetch

    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'sync-test@example.com',
      todoistUserId: 'sync-todoist-user-1'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const result = await todoistSyncService.runInitialSync(user.id, 'test-token')

      expect(result.projectCount).toBe(3)
      expect(result.taskCount).toBe(2)
      expect(result.subtaskCount).toBe(1)

      const stored = await itemMappingsRepository.findByUserId(user.id)
      expect(stored).toHaveLength(6)

      const projects = stored.filter(i => i.itemType === 'project')
      expect(projects).toHaveLength(3)

      const rootTasks = stored.filter(i => i.itemType === 'task')
      expect(rootTasks).toHaveLength(2)

      const subtasks = stored.filter(i => i.itemType === 'subtask')
      expect(subtasks).toHaveLength(1)
      expect(subtasks[0]?.parentTodoistItemId).toBe('task-2')

      const withDue = stored.find(i => i.todoistItemId === 'task-2')
      expect(withDue?.dueAt).not.toBeNull()
      expect(withDue?.dueAt).toBeInstanceOf(Date)

      const subProject = stored.find(i => i.todoistItemId === 'proj-3')
      expect(subProject?.parentTodoistItemId).toBe('proj-2')
    } finally {
      globalThis.fetch = originalFetch
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('is idempotent — running sync twice does not duplicate rows', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock() as typeof fetch

    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'sync-idempotent@example.com',
      todoistUserId: 'sync-todoist-user-2'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      await todoistSyncService.runInitialSync(user.id, 'test-token')
      await todoistSyncService.runInitialSync(user.id, 'test-token')

      const stored = await itemMappingsRepository.findByUserId(user.id)
      expect(stored).toHaveLength(6)
    } finally {
      globalThis.fetch = originalFetch
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})

describe('Milestone 6 — initialSyncCompleted session readiness', () => {
  runIfDatabaseConfigured('countByUserId returns 0 before sync and correct count after sync', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock() as typeof fetch

    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'sync-count@example.com',
      todoistUserId: 'sync-todoist-user-3'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const beforeCount = await itemMappingsRepository.countByUserId(user.id)
      expect(beforeCount).toBe(0)

      await todoistSyncService.runInitialSync(user.id, 'test-token')

      const afterCount = await itemMappingsRepository.countByUserId(user.id)
      expect(afterCount).toBe(6)
    } finally {
      globalThis.fetch = originalFetch
      await db.delete(users).where(eq(users.id, user.id))
    }
  })

  runIfDatabaseConfigured('session reports initialSyncCompleted:true once items are synced', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock() as typeof fetch

    const db = getDb()
    const [user] = await db.insert(users).values({
      email: 'sync-session@example.com',
      todoistUserId: 'sync-todoist-user-4'
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      expect(await itemMappingsRepository.countByUserId(user.id)).toBe(0)

      await todoistSyncService.runInitialSync(user.id, 'test-token')

      expect(await itemMappingsRepository.countByUserId(user.id)).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = originalFetch
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
