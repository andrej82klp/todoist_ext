import { and, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { PriorityLevel } from '../../shared/types'
import { getDb } from '../db/client'
import { taskMetadata, todoistItemMappings } from '../db/schema'

export interface TaskWithMetaRow {
  id: string
  todoistItemId: string
  projectTodoistId: string | null
  title: string
  dueAt: Date | null
  isCompleted: boolean
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
  completionBonusEnabled: boolean
  completionBonusPercent: number
  badge: string | null
  customPointOverride: number | null
}

export interface SubtaskCountRow {
  parentTodoistItemId: string
  subtaskCount: number
  completedSubtaskCount: number
}

export interface SubtaskRow {
  id: string
  todoistItemId: string
  title: string
  isCompleted: boolean
}

export interface ProjectNameRow {
  todoistItemId: string
  id: string
  title: string
}

export interface UpsertTaskMetadataInput {
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
  completionBonusEnabled: boolean
  completionBonusPercent: number
  badge: string | null
  customPointOverride: number | null
}

const DEFAULT_METADATA: Omit<UpsertTaskMetadataInput, never> = {
  priority: 'medium',
  difficulty: 1,
  timeEstimateMinutes: null,
  completionBonusEnabled: true,
  completionBonusPercent: 10,
  badge: null,
  customPointOverride: null
}

export const tasksRepository = {
  async findTasksWithMeta(
    userId: string,
    opts: { projectTodoistId?: string, includeCompleted?: boolean } = {}
  ): Promise<TaskWithMetaRow[]> {
    const db = getDb()

    const conditions = [
      eq(todoistItemMappings.userId, userId),
      eq(todoistItemMappings.itemType, 'task')
    ]

    if (!opts.includeCompleted) {
      conditions.push(eq(todoistItemMappings.isCompleted, false))
    }

    if (opts.projectTodoistId) {
      conditions.push(eq(todoistItemMappings.projectTodoistId, opts.projectTodoistId))
    }

    const rows = await db
      .select({
        id: todoistItemMappings.id,
        todoistItemId: todoistItemMappings.todoistItemId,
        projectTodoistId: todoistItemMappings.projectTodoistId,
        title: todoistItemMappings.title,
        dueAt: todoistItemMappings.dueAt,
        isCompleted: todoistItemMappings.isCompleted,
        priority: taskMetadata.priority,
        difficulty: taskMetadata.difficulty,
        timeEstimateMinutes: taskMetadata.timeEstimateMinutes,
        completionBonusEnabled: taskMetadata.completionBonusEnabled,
        completionBonusPercent: taskMetadata.completionBonusPercent,
        badge: taskMetadata.badge,
        customPointOverride: taskMetadata.customPointOverride
      })
      .from(todoistItemMappings)
      .leftJoin(
        taskMetadata,
        and(
          eq(taskMetadata.todoistItemMappingId, todoistItemMappings.id),
          eq(taskMetadata.userId, userId)
        )
      )
      .where(and(...conditions))

    return rows.map(row => ({
      ...row,
      priority: (row.priority ?? DEFAULT_METADATA.priority) as PriorityLevel,
      difficulty: row.difficulty ?? DEFAULT_METADATA.difficulty,
      timeEstimateMinutes: row.timeEstimateMinutes ?? DEFAULT_METADATA.timeEstimateMinutes,
      completionBonusEnabled: row.completionBonusEnabled ?? DEFAULT_METADATA.completionBonusEnabled,
      completionBonusPercent: Number(row.completionBonusPercent ?? DEFAULT_METADATA.completionBonusPercent),
      badge: row.badge ?? DEFAULT_METADATA.badge,
      customPointOverride: row.customPointOverride ?? DEFAULT_METADATA.customPointOverride
    }))
  },

  async findTaskById(userId: string, taskId: string): Promise<TaskWithMetaRow | null> {
    const db = getDb()

    const [row] = await db
      .select({
        id: todoistItemMappings.id,
        todoistItemId: todoistItemMappings.todoistItemId,
        projectTodoistId: todoistItemMappings.projectTodoistId,
        title: todoistItemMappings.title,
        dueAt: todoistItemMappings.dueAt,
        isCompleted: todoistItemMappings.isCompleted,
        priority: taskMetadata.priority,
        difficulty: taskMetadata.difficulty,
        timeEstimateMinutes: taskMetadata.timeEstimateMinutes,
        completionBonusEnabled: taskMetadata.completionBonusEnabled,
        completionBonusPercent: taskMetadata.completionBonusPercent,
        badge: taskMetadata.badge,
        customPointOverride: taskMetadata.customPointOverride
      })
      .from(todoistItemMappings)
      .leftJoin(
        taskMetadata,
        and(
          eq(taskMetadata.todoistItemMappingId, todoistItemMappings.id),
          eq(taskMetadata.userId, userId)
        )
      )
      .where(and(
        eq(todoistItemMappings.id, taskId),
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'task')
      ))
      .limit(1)

    if (!row) return null

    return {
      ...row,
      priority: (row.priority ?? DEFAULT_METADATA.priority) as PriorityLevel,
      difficulty: row.difficulty ?? DEFAULT_METADATA.difficulty,
      timeEstimateMinutes: row.timeEstimateMinutes ?? DEFAULT_METADATA.timeEstimateMinutes,
      completionBonusEnabled: row.completionBonusEnabled ?? DEFAULT_METADATA.completionBonusEnabled,
      completionBonusPercent: Number(row.completionBonusPercent ?? DEFAULT_METADATA.completionBonusPercent),
      badge: row.badge ?? DEFAULT_METADATA.badge,
      customPointOverride: row.customPointOverride ?? DEFAULT_METADATA.customPointOverride
    }
  },

  async getSubtaskCounts(userId: string, parentTodoistItemIds: string[]): Promise<SubtaskCountRow[]> {
    if (parentTodoistItemIds.length === 0) return []

    const db = getDb()
    const subtaskAlias = alias(todoistItemMappings, 'sub')

    const rows = await db
      .select({
        parentTodoistItemId: subtaskAlias.parentTodoistItemId,
        subtaskCount: sql<number>`COUNT(*)::int`,
        completedSubtaskCount: sql<number>`COUNT(*) FILTER (WHERE ${subtaskAlias.isCompleted} = true)::int`
      })
      .from(subtaskAlias)
      .where(and(
        eq(subtaskAlias.userId, userId),
        eq(subtaskAlias.itemType, 'subtask'),
        inArray(subtaskAlias.parentTodoistItemId, parentTodoistItemIds)
      ))
      .groupBy(subtaskAlias.parentTodoistItemId)

    return rows.map(r => ({
      parentTodoistItemId: r.parentTodoistItemId!,
      subtaskCount: r.subtaskCount,
      completedSubtaskCount: r.completedSubtaskCount
    }))
  },

  async getSubtasksForTask(userId: string, parentTodoistItemId: string): Promise<SubtaskRow[]> {
    const db = getDb()

    return db
      .select({
        id: todoistItemMappings.id,
        todoistItemId: todoistItemMappings.todoistItemId,
        title: todoistItemMappings.title,
        isCompleted: todoistItemMappings.isCompleted
      })
      .from(todoistItemMappings)
      .where(and(
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'subtask'),
        eq(todoistItemMappings.parentTodoistItemId, parentTodoistItemId)
      ))
  },

  async getProjectNames(userId: string, projectTodoistIds: string[]): Promise<ProjectNameRow[]> {
    if (projectTodoistIds.length === 0) return []

    const db = getDb()

    return db
      .select({
        todoistItemId: todoistItemMappings.todoistItemId,
        id: todoistItemMappings.id,
        title: todoistItemMappings.title
      })
      .from(todoistItemMappings)
      .where(and(
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'project'),
        inArray(todoistItemMappings.todoistItemId, projectTodoistIds)
      ))
  },

  async upsertTaskMetadata(
    userId: string,
    taskMappingId: string,
    input: UpsertTaskMetadataInput
  ) {
    const db = getDb()

    const [record] = await db
      .insert(taskMetadata)
      .values({
        userId,
        todoistItemMappingId: taskMappingId,
        priority: input.priority,
        difficulty: input.difficulty,
        timeEstimateMinutes: input.timeEstimateMinutes,
        completionBonusEnabled: input.completionBonusEnabled,
        completionBonusPercent: String(input.completionBonusPercent),
        badge: input.badge,
        customPointOverride: input.customPointOverride
      })
      .onConflictDoUpdate({
        target: [taskMetadata.userId, taskMetadata.todoistItemMappingId],
        set: {
          priority: input.priority,
          difficulty: input.difficulty,
          timeEstimateMinutes: input.timeEstimateMinutes,
          completionBonusEnabled: input.completionBonusEnabled,
          completionBonusPercent: String(input.completionBonusPercent),
          badge: input.badge,
          customPointOverride: input.customPointOverride,
          updatedAt: new Date()
        }
      })
      .returning()

    return record!
  }
}
