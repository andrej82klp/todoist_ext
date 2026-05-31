import { and, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { PriorityLevel } from '../../shared/types'
import type { DatabaseClient } from '../db/client'
import { getDb } from '../db/client'
import { taskMetadata, todoistItemMappings } from '../db/schema'

/** Row returned for a parent task (itemType = 'task') with its group metadata. */
export interface TaskWithMetaRow {
  id: string
  todoistItemId: string
  projectTodoistId: string | null
  title: string
  dueAt: Date | null
  isCompleted: boolean
  badge: string | null
  completionBonusPoints: number
}

/** Row returned for a subtask (itemType = 'subtask') with its scoring metadata. */
export interface SubtaskWithMetaRow {
  id: string
  todoistItemId: string
  parentTodoistItemId: string | null
  title: string
  isCompleted: boolean
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
}

export interface SubtaskCountRow {
  parentTodoistItemId: string
  subtaskCount: number
  completedSubtaskCount: number
}

/** Legacy subtask row without metadata (used for lightweight detail calls). */
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

/** Input for upserting parent task (group) metadata. */
export interface UpsertTaskGroupMetadataInput {
  badge: string | null
  completionBonusPoints: number
}

/** Input for upserting subtask scoring metadata. */
export interface UpsertSubtaskMetadataInput {
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
}

/** @deprecated Use UpsertTaskGroupMetadataInput or UpsertSubtaskMetadataInput */
export interface UpsertTaskMetadataInput {
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
  completionBonusEnabled: boolean
  completionBonusPercent: number
  badge: string | null
  customPointOverride: number | null
}

const DEFAULT_TASK_METADATA = {
  badge: null as string | null,
  completionBonusPoints: 0
}

const DEFAULT_SUBTASK_METADATA = {
  priority: 'medium' as PriorityLevel,
  difficulty: 1,
  timeEstimateMinutes: null as number | null
}

async function selectSubtaskCounts(db: DatabaseClient, userId: string, parentTodoistItemIds: string[]): Promise<SubtaskCountRow[]> {
  if (parentTodoistItemIds.length === 0) return []

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
}

async function selectTaskByTodoistItemId(
  db: DatabaseClient,
  userId: string,
  todoistItemId: string
): Promise<TaskWithMetaRow | null> {
  const [row] = await db
    .select({
      id: todoistItemMappings.id,
      todoistItemId: todoistItemMappings.todoistItemId,
      projectTodoistId: todoistItemMappings.projectTodoistId,
      title: todoistItemMappings.title,
      dueAt: todoistItemMappings.dueAt,
      isCompleted: todoistItemMappings.isCompleted,
      badge: taskMetadata.badge,
      completionBonusPoints: taskMetadata.completionBonusPoints
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
      eq(todoistItemMappings.userId, userId),
      eq(todoistItemMappings.todoistItemId, todoistItemId)
    ))
    .limit(1)

  if (!row) return null

  return {
    ...row,
    badge: row.badge ?? DEFAULT_TASK_METADATA.badge,
    completionBonusPoints: row.completionBonusPoints ?? DEFAULT_TASK_METADATA.completionBonusPoints
  }
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
        badge: taskMetadata.badge,
        completionBonusPoints: taskMetadata.completionBonusPoints
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
      badge: row.badge ?? DEFAULT_TASK_METADATA.badge,
      completionBonusPoints: row.completionBonusPoints ?? DEFAULT_TASK_METADATA.completionBonusPoints
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
        badge: taskMetadata.badge,
        completionBonusPoints: taskMetadata.completionBonusPoints
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
      badge: row.badge ?? DEFAULT_TASK_METADATA.badge,
      completionBonusPoints: row.completionBonusPoints ?? DEFAULT_TASK_METADATA.completionBonusPoints
    }
  },

  async findTaskByTodoistItemId(userId: string, todoistItemId: string): Promise<TaskWithMetaRow | null> {
    const db = getDb()
    return selectTaskByTodoistItemId(db, userId, todoistItemId)
  },

  async findTaskByTodoistItemIdInTransaction(tx: DatabaseClient, userId: string, todoistItemId: string): Promise<TaskWithMetaRow | null> {
    return selectTaskByTodoistItemId(tx, userId, todoistItemId)
  },

  async getSubtaskCounts(userId: string, parentTodoistItemIds: string[]): Promise<SubtaskCountRow[]> {
    const db = getDb()
    return selectSubtaskCounts(db, userId, parentTodoistItemIds)
  },

  async getSubtaskCountsInTransaction(tx: DatabaseClient, userId: string, parentTodoistItemIds: string[]): Promise<SubtaskCountRow[]> {
    return selectSubtaskCounts(tx, userId, parentTodoistItemIds)
  },

  /** Returns subtasks for a parent with full scoring metadata. */
  async getSubtasksWithMetaForTask(userId: string, parentTodoistItemId: string): Promise<SubtaskWithMetaRow[]> {
    const db = getDb()
    return this.getSubtasksWithMetaForTaskInTransaction(db as unknown as DatabaseClient, userId, parentTodoistItemId)
  },

  /** Transaction-aware version for use inside existing transactions. */
  async getSubtasksWithMetaForTaskInTransaction(tx: DatabaseClient, userId: string, parentTodoistItemId: string): Promise<SubtaskWithMetaRow[]> {
    const rows = await tx
      .select({
        id: todoistItemMappings.id,
        todoistItemId: todoistItemMappings.todoistItemId,
        parentTodoistItemId: todoistItemMappings.parentTodoistItemId,
        title: todoistItemMappings.title,
        isCompleted: todoistItemMappings.isCompleted,
        priority: taskMetadata.priority,
        difficulty: taskMetadata.difficulty,
        timeEstimateMinutes: taskMetadata.timeEstimateMinutes
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
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'subtask'),
        eq(todoistItemMappings.parentTodoistItemId, parentTodoistItemId)
      ))

    return rows.map(row => ({
      ...row,
      priority: (row.priority ?? DEFAULT_SUBTASK_METADATA.priority) as PriorityLevel,
      difficulty: row.difficulty ?? DEFAULT_SUBTASK_METADATA.difficulty,
      timeEstimateMinutes: row.timeEstimateMinutes ?? DEFAULT_SUBTASK_METADATA.timeEstimateMinutes
    }))
  },

  /** Looks up a single subtask by its own todoistItemId with scoring metadata (transaction-aware). */
  async findSubtaskWithMetaByTodoistItemIdInTransaction(tx: DatabaseClient, userId: string, todoistItemId: string): Promise<SubtaskWithMetaRow | null> {
    const rows = await tx
      .select({
        id: todoistItemMappings.id,
        todoistItemId: todoistItemMappings.todoistItemId,
        parentTodoistItemId: todoistItemMappings.parentTodoistItemId,
        title: todoistItemMappings.title,
        isCompleted: todoistItemMappings.isCompleted,
        priority: taskMetadata.priority,
        difficulty: taskMetadata.difficulty,
        timeEstimateMinutes: taskMetadata.timeEstimateMinutes
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
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'subtask'),
        eq(todoistItemMappings.todoistItemId, todoistItemId)
      ))
      .limit(1)

    const row = rows[0]
    if (!row) return null

    return {
      ...row,
      priority: (row.priority ?? DEFAULT_SUBTASK_METADATA.priority) as PriorityLevel,
      difficulty: row.difficulty ?? DEFAULT_SUBTASK_METADATA.difficulty,
      timeEstimateMinutes: row.timeEstimateMinutes ?? DEFAULT_SUBTASK_METADATA.timeEstimateMinutes
    }
  },

  /** Returns subtasks with metadata for multiple parents (bulk load, avoids N+1). */
  async getSubtasksWithMetaForParents(userId: string, parentTodoistItemIds: string[]): Promise<SubtaskWithMetaRow[]> {
    if (parentTodoistItemIds.length === 0) return []

    const db = getDb()

    const rows = await db
      .select({
        id: todoistItemMappings.id,
        todoistItemId: todoistItemMappings.todoistItemId,
        parentTodoistItemId: todoistItemMappings.parentTodoistItemId,
        title: todoistItemMappings.title,
        isCompleted: todoistItemMappings.isCompleted,
        priority: taskMetadata.priority,
        difficulty: taskMetadata.difficulty,
        timeEstimateMinutes: taskMetadata.timeEstimateMinutes
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
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'subtask'),
        inArray(todoistItemMappings.parentTodoistItemId, parentTodoistItemIds)
      ))

    return rows.map(row => ({
      ...row,
      priority: (row.priority ?? DEFAULT_SUBTASK_METADATA.priority) as PriorityLevel,
      difficulty: row.difficulty ?? DEFAULT_SUBTASK_METADATA.difficulty,
      timeEstimateMinutes: row.timeEstimateMinutes ?? DEFAULT_SUBTASK_METADATA.timeEstimateMinutes
    }))
  },

  /** Legacy lightweight subtask rows (no metadata). Kept for internal usage. */
  async getSubtasksForTask(userId: string, parentTodoistItemId: string): Promise<SubtaskRow[]> {
    return this.getSubtasksWithMetaForTask(userId, parentTodoistItemId)
  },

  /** Finds a specific subtask by internal ID, validating it belongs to the given parent. */
  async findSubtaskByIdForParent(
    userId: string,
    subtaskId: string,
    parentTaskId: string
  ): Promise<SubtaskWithMetaRow | null> {
    const db = getDb()

    // First find the parent to get its todoistItemId
    const [parentRow] = await db
      .select({ todoistItemId: todoistItemMappings.todoistItemId })
      .from(todoistItemMappings)
      .where(and(
        eq(todoistItemMappings.id, parentTaskId),
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'task')
      ))
      .limit(1)

    if (!parentRow) return null

    const [row] = await db
      .select({
        id: todoistItemMappings.id,
        todoistItemId: todoistItemMappings.todoistItemId,
        parentTodoistItemId: todoistItemMappings.parentTodoistItemId,
        title: todoistItemMappings.title,
        isCompleted: todoistItemMappings.isCompleted,
        priority: taskMetadata.priority,
        difficulty: taskMetadata.difficulty,
        timeEstimateMinutes: taskMetadata.timeEstimateMinutes
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
        eq(todoistItemMappings.id, subtaskId),
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, 'subtask'),
        eq(todoistItemMappings.parentTodoistItemId, parentRow.todoistItemId)
      ))
      .limit(1)

    if (!row) return null

    return {
      ...row,
      priority: (row.priority ?? DEFAULT_SUBTASK_METADATA.priority) as PriorityLevel,
      difficulty: row.difficulty ?? DEFAULT_SUBTASK_METADATA.difficulty,
      timeEstimateMinutes: row.timeEstimateMinutes ?? DEFAULT_SUBTASK_METADATA.timeEstimateMinutes
    }
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

  /** Upserts parent task (group) metadata: badge and completionBonusPoints. */
  async upsertTaskGroupMetadata(
    userId: string,
    taskMappingId: string,
    input: UpsertTaskGroupMetadataInput
  ) {
    const db = getDb()

    const [record] = await db
      .insert(taskMetadata)
      .values({
        userId,
        todoistItemMappingId: taskMappingId,
        badge: input.badge,
        completionBonusPoints: input.completionBonusPoints
      })
      .onConflictDoUpdate({
        target: [taskMetadata.userId, taskMetadata.todoistItemMappingId],
        set: {
          badge: input.badge,
          completionBonusPoints: input.completionBonusPoints,
          updatedAt: new Date()
        }
      })
      .returning()

    return record!
  },

  /** Upserts subtask scoring metadata: priority, difficulty, timeEstimateMinutes. */
  async upsertSubtaskMetadata(
    userId: string,
    subtaskMappingId: string,
    input: UpsertSubtaskMetadataInput
  ) {
    const db = getDb()

    const [record] = await db
      .insert(taskMetadata)
      .values({
        userId,
        todoistItemMappingId: subtaskMappingId,
        priority: input.priority,
        difficulty: input.difficulty,
        timeEstimateMinutes: input.timeEstimateMinutes
      })
      .onConflictDoUpdate({
        target: [taskMetadata.userId, taskMetadata.todoistItemMappingId],
        set: {
          priority: input.priority,
          difficulty: input.difficulty,
          timeEstimateMinutes: input.timeEstimateMinutes,
          updatedAt: new Date()
        }
      })
      .returning()

    return record!
  },

  /**
   * @deprecated Use upsertTaskGroupMetadata or upsertSubtaskMetadata.
   * Kept for test backward compatibility during migration.
   */
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
        completionBonusPoints: 0,
        badge: input.badge
      })
      .onConflictDoUpdate({
        target: [taskMetadata.userId, taskMetadata.todoistItemMappingId],
        set: {
          priority: input.priority,
          difficulty: input.difficulty,
          timeEstimateMinutes: input.timeEstimateMinutes,
          badge: input.badge,
          updatedAt: new Date()
        }
      })
      .returning()

    return record!
  }
}
