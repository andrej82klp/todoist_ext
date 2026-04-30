import { and, count, eq, sql } from 'drizzle-orm'

import { getDb } from '../db/client'
import { todoistItemMappings } from '../db/schema'

export type ItemType = 'project' | 'task' | 'subtask'

export interface UpsertItemMappingInput {
  todoistItemId: string
  itemType: ItemType
  parentTodoistItemId?: string | null
  projectTodoistId?: string | null
  title: string
  dueAt?: Date | null
  isCompleted?: boolean
}

export const itemMappingsRepository = {
  async upsertMany(userId: string, items: UpsertItemMappingInput[]) {
    if (items.length === 0) {
      return []
    }

    const db = getDb()
    const now = new Date()

    const values = items.map(item => ({
      userId,
      todoistItemId: item.todoistItemId,
      itemType: item.itemType,
      parentTodoistItemId: item.parentTodoistItemId ?? null,
      projectTodoistId: item.projectTodoistId ?? null,
      title: item.title,
      dueAt: item.dueAt ?? null,
      isCompleted: item.isCompleted ?? false,
      syncedAt: now
    }))

    return db.insert(todoistItemMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [todoistItemMappings.userId, todoistItemMappings.todoistItemId],
        set: {
          itemType: sql`excluded.item_type`,
          parentTodoistItemId: sql`excluded.parent_todoist_item_id`,
          projectTodoistId: sql`excluded.project_todoist_id`,
          title: sql`excluded.title`,
          dueAt: sql`excluded.due_at`,
          isCompleted: sql`excluded.is_completed`,
          syncedAt: sql`excluded.synced_at`,
          updatedAt: now
        }
      })
      .returning()
  },

  async countByUserId(userId: string) {
    const db = getDb()
    const [result] = await db
      .select({ value: count() })
      .from(todoistItemMappings)
      .where(eq(todoistItemMappings.userId, userId))

    return result?.value ?? 0
  },

  async findByUserId(userId: string) {
    const db = getDb()
    return db.select()
      .from(todoistItemMappings)
      .where(eq(todoistItemMappings.userId, userId))
  },

  async findByUserIdAndType(userId: string, itemType: ItemType) {
    const db = getDb()
    return db.select()
      .from(todoistItemMappings)
      .where(and(
        eq(todoistItemMappings.userId, userId),
        eq(todoistItemMappings.itemType, itemType)
      ))
  }
}
