import { and, asc, eq, inArray, isNotNull, sum } from 'drizzle-orm'

import { getDb } from '../db/client'
import { milestoneAwards, pointLedger, todoistItemMappings } from '../db/schema'

// Sources written by the Todoist webhook service that represent project-attributable work.
const WORK_SOURCES: string[] = [
  'todoist_webhook_subtask_completion',
  'todoist_webhook_task_completion_bonus'
]

export interface AnalyticsProjectRow {
  projectId: string
  projectName: string
  pointsEarned: number
}

export const analyticsRepository = {
  /**
   * Aggregate points earned per project for the user.
   *
   * Only includes ledger rows that are attributable to Todoist work items:
   * - `earned` rows from subtask completions
   * - `bonus` rows from task completion bonuses (not streak milestone bonuses)
   *
   * Join path:
   *   point_ledger.related_entity_id -> todoist_item_mappings.todoist_item_id
   *   todoist_item_mappings.project_todoist_id -> project mapping row title
   *
   * Returns up to `limit` rows sorted by points descending, then project id ascending
   * for stable ordering when totals are equal.
   */
  async listMostRewardingProjectsByUserId(userId: string, limit = 5): Promise<AnalyticsProjectRow[]> {
    const db = getDb()

    // Step 1: aggregate work points per item, filtering to eligible sources only.
    const itemRows = await db
      .select({
        projectTodoistId: todoistItemMappings.projectTodoistId,
        pointsEarned: sum(pointLedger.amount).as('points_earned')
      })
      .from(pointLedger)
      .innerJoin(
        todoistItemMappings,
        and(
          eq(todoistItemMappings.userId, pointLedger.userId),
          eq(todoistItemMappings.todoistItemId, pointLedger.relatedEntityId)
        )
      )
      .where(
        and(
          eq(pointLedger.userId, userId),
          inArray(pointLedger.source, WORK_SOURCES),
          isNotNull(todoistItemMappings.projectTodoistId)
        )
      )
      .groupBy(todoistItemMappings.projectTodoistId)

    if (itemRows.length === 0) {
      return []
    }

    // Step 2: aggregate per project across all items.
    const projectTotals = new Map<string, number>()
    for (const row of itemRows) {
      if (!row.projectTodoistId) continue
      const prev = projectTotals.get(row.projectTodoistId) ?? 0
      projectTotals.set(row.projectTodoistId, prev + Number(row.pointsEarned ?? 0))
    }

    // Step 3: resolve project display names.
    const projectIds = [...projectTotals.keys()]
    const projectNameRows = await db
      .select({
        todoistItemId: todoistItemMappings.todoistItemId,
        title: todoistItemMappings.title
      })
      .from(todoistItemMappings)
      .where(
        and(
          eq(todoistItemMappings.userId, userId),
          eq(todoistItemMappings.itemType, 'project'),
          inArray(todoistItemMappings.todoistItemId, projectIds)
        )
      )

    const projectNameMap = new Map(projectNameRows.map(p => [p.todoistItemId, p.title]))

    // Step 4: build, sort, limit, and map to the output shape.
    const sorted = [...projectTotals.entries()]
      .sort(([aId, aPoints], [bId, bPoints]) => {
        if (bPoints !== aPoints) return bPoints - aPoints
        return aId.localeCompare(bId)
      })
      .slice(0, limit)

    return sorted.map(([projectTodoistId, pointsEarned]) => ({
      projectId: projectTodoistId,
      projectName: projectNameMap.get(projectTodoistId) ?? 'Unknown project',
      pointsEarned
    }))
  },

  /**
   * List the milestone day thresholds that have been awarded to the user, sorted
   * ascending. Uses `awardedForDays` directly from `milestone_awards` to remain
   * history-preserving even if milestone definitions later change or are deleted.
   */
  async listReachedMilestonesByUserId(userId: string): Promise<number[]> {
    const db = getDb()

    const rows = await db
      .select({ awardedForDays: milestoneAwards.awardedForDays })
      .from(milestoneAwards)
      .where(eq(milestoneAwards.userId, userId))
      .orderBy(asc(milestoneAwards.awardedForDays))

    return rows.map(r => r.awardedForDays)
  }
}
