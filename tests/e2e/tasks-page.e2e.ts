import { randomUUID } from 'node:crypto'

import 'dotenv/config'

import { eq } from 'drizzle-orm'
import { expect, test, type Page } from '@playwright/test'

import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { taskMetadata, todoistItemMappings, users } from '../../server/db/schema'
import { itemMappingsRepository } from '../../server/repositories/item-mappings'

interface SeededUser {
  id: string
  email: string
}

test.afterAll(async () => {
  await closeDbConnection()
})

async function createSeededUser(emailPrefix: string): Promise<SeededUser> {
  const db = getDb()
  const [user] = await db.insert(users).values({
    email: `${emailPrefix}-${randomUUID()}@example.com`,
    todoistUserId: `todoist-${randomUUID()}`
  }).returning({
    id: users.id,
    email: users.email
  })

  await ensureUserDefaults(user.id)

  return user
}

async function cleanupUser(userId: string) {
  const db = getDb()
  await db.delete(users).where(eq(users.id, userId))
}

async function establishSession(page: Page, userId: string) {
  const response = await page.request.post('/api/internal/test-auth/session', {
    data: { userId }
  })

  expect(response.ok()).toBeTruthy()
}

async function seedTasksForPlanningSurface(userId: string) {
  const db = getDb()

  const dueSoon = new Date(Date.now() + 24 * 60 * 60 * 1000)

  const mappings = await itemMappingsRepository.upsertMany(userId, [
    { todoistItemId: 'proj-alpha', itemType: 'project', title: 'Alpha' },
    { todoistItemId: 'proj-beta', itemType: 'project', title: 'Beta' },
    { todoistItemId: 'task-alpha', itemType: 'task', title: 'Ship milestone checklist', projectTodoistId: 'proj-alpha', dueAt: dueSoon },
    { todoistItemId: 'task-beta', itemType: 'task', title: 'Write rollout notes', projectTodoistId: 'proj-beta' },
    { todoistItemId: 'task-complete', itemType: 'task', title: 'Completed planning item', projectTodoistId: 'proj-alpha', isCompleted: true },
    { todoistItemId: 'sub-alpha-1', itemType: 'subtask', title: 'Draft checklist', parentTodoistItemId: 'task-alpha', projectTodoistId: 'proj-alpha' },
    { todoistItemId: 'sub-alpha-2', itemType: 'subtask', title: 'Review checklist', parentTodoistItemId: 'task-alpha', projectTodoistId: 'proj-alpha', isCompleted: true }
  ])

  const taskAlphaMapping = mappings.find(mapping => mapping.todoistItemId === 'task-alpha')
  const taskBetaMapping = mappings.find(mapping => mapping.todoistItemId === 'task-beta')

  if (!taskAlphaMapping || !taskBetaMapping) {
    throw new Error('Failed to seed task mappings for e2e test')
  }

  await db.insert(taskMetadata).values([
    {
      userId,
      todoistItemMappingId: taskAlphaMapping.id,
      priority: 'high',
      difficulty: 6,
      timeEstimateMinutes: 60,
      completionBonusEnabled: true,
      completionBonusPercent: '10.00',
      badge: null,
      customPointOverride: null
    },
    {
      userId,
      todoistItemMappingId: taskBetaMapping.id,
      priority: 'low',
      difficulty: 2,
      timeEstimateMinutes: 30,
      completionBonusEnabled: true,
      completionBonusPercent: '10.00',
      badge: null,
      customPointOverride: null
    }
  ])
}

test.describe('Tasks page', () => {
  test('route synced filters and metadata editing refresh list output', async ({ page }) => {
    const user = await createSeededUser('tasks-route-sync')

    try {
      await seedTasksForPlanningSurface(user.id)
      await establishSession(page, user.id)

      await page.goto('/tasks')

      await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Priority' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Difficulty' })).toBeVisible()
      await expect(page.getByTestId('tasks-project-filter')).toContainText('Alpha')
      await expect(page.getByTestId('tasks-project-filter')).toContainText('Beta')

      await page.selectOption('[data-testid="tasks-project-filter"]', 'proj-beta')
      await expect(page.getByTestId('tasks-project-filter')).toHaveValue('proj-beta')
      await expect(page.locator('[data-testid="task-row-task-beta"]:visible')).toHaveCount(1)
      await expect(page.locator('[data-testid="task-row-task-alpha"]:visible')).toHaveCount(0)

      await page.selectOption('[data-testid="tasks-project-filter"]', '')
      await page.selectOption('[data-testid="tasks-sort-by"]', 'difficulty')
      await page.selectOption('[data-testid="tasks-sort-order"]', 'asc')
      await expect(page.locator('[data-testid^="task-row-"]:visible').first()).toHaveAttribute('data-testid', 'task-row-task-beta')

      await expect(page.getByText('No subtasks').first()).toBeVisible()
      await page.selectOption('[data-testid="tasks-project-filter"]', 'proj-alpha')
      await expect(page.getByText('Due soon').first()).toBeVisible()

      await page.selectOption('[data-testid="tasks-project-filter"]', 'proj-beta')
      await page.locator('[data-testid="task-edit-task-beta"]:visible').click()

      await expect(page.getByRole('heading', { name: 'Task metadata' })).toBeVisible()
      await page.getByTestId('metadata-difficulty').fill('9')
      await page.getByTestId('metadata-save').click()

      await expect(page.getByRole('heading', { name: 'Task metadata' })).toHaveCount(0)
      await expect(page.locator('[data-testid="task-points-task-beta"]:visible')).toHaveText('90')

      const db = getDb()
      const [persistedMapping] = await db.select({ id: todoistItemMappings.id })
        .from(todoistItemMappings)
        .where(eq(todoistItemMappings.todoistItemId, 'task-beta'))

      expect(persistedMapping).toBeTruthy()

      const [persistedMetadata] = await db.select({
        difficulty: taskMetadata.difficulty,
        priority: taskMetadata.priority,
        completionBonusPercent: taskMetadata.completionBonusPercent
      }).from(taskMetadata).where(eq(taskMetadata.todoistItemMappingId, persistedMapping!.id))

      expect(persistedMetadata).toEqual({
        difficulty: 9,
        priority: 'low',
        completionBonusPercent: '10.00'
      })
    } finally {
      await cleanupUser(user.id)
    }
  })

  test('shows empty state when no tasks are returned', async ({ page }) => {
    const user = await createSeededUser('tasks-empty-state')

    try {
      await establishSession(page, user.id)
      await page.goto('/tasks')
      await expect(page.getByText('No tasks in this view')).toBeVisible()
    } finally {
      await cleanupUser(user.id)
    }
  })

  test('renders mobile card layout actions', async ({ page }) => {
    const user = await createSeededUser('tasks-mobile-layout')

    try {
      await seedTasksForPlanningSurface(user.id)
      await establishSession(page, user.id)

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/tasks')

      await expect(page.locator('[data-testid="task-row-task-alpha"]:visible')).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Edit metadata' }).first()).toBeVisible()
    } finally {
      await cleanupUser(user.id)
    }
  })
})
