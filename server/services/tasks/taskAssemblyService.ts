import type { EnrichedTask, EnrichedTaskDetail, SubtaskMetadata, TaskGroupMetadata, TaskSubtaskSummary } from '../../../shared/types'
import { settingsRepository } from '../../repositories/settings'
import type { SubtaskWithMetaRow, TaskWithMetaRow } from '../../repositories/tasks'
import { tasksRepository } from '../../repositories/tasks'
import {
  calculateEstimatedPoints,
  getDefaultPointsSettings,
  isDeadlineApproaching,
  settingsToPointsSettings
} from './pointsCalculator'

function rowToGroupMetadata(row: TaskWithMetaRow): TaskGroupMetadata {
  return {
    badge: row.badge,
    completionBonusPoints: row.completionBonusPoints
  }
}

function subtaskRowToMetadata(row: SubtaskWithMetaRow): SubtaskMetadata {
  return {
    priority: row.priority,
    difficulty: row.difficulty,
    timeEstimateMinutes: row.timeEstimateMinutes
  }
}

function formatDeadline(dueAt: Date | null): string | null {
  if (!dueAt) return null
  return dueAt.toISOString().slice(0, 10)
}

export const taskAssemblyService = {
  async buildEnrichedTaskList(userId: string, rows: TaskWithMetaRow[]): Promise<EnrichedTask[]> {
    if (rows.length === 0) return []

    const [settings, subtaskCounts, projectNames, allSubtasks] = await Promise.all([
      settingsRepository.findByUserId(userId),
      tasksRepository.getSubtaskCounts(userId, rows.map(r => r.todoistItemId)),
      tasksRepository.getProjectNames(userId, [...new Set(rows.map(r => r.projectTodoistId).filter(Boolean) as string[])]),
      tasksRepository.getSubtasksWithMetaForParents(userId, rows.map(r => r.todoistItemId))
    ])

    const pointsSettings = settings
      ? settingsToPointsSettings(settings)
      : getDefaultPointsSettings()

    const subtaskCountMap = new Map(
      subtaskCounts.map(s => [s.parentTodoistItemId, s])
    )

    const projectNameMap = new Map(
      projectNames.map(p => [p.todoistItemId, p.title])
    )

    // Group subtasks by parent for point total computation
    const subtasksByParent = new Map<string, SubtaskWithMetaRow[]>()
    for (const sub of allSubtasks) {
      const parentId = sub.parentTodoistItemId
      if (!parentId) continue
      if (!subtasksByParent.has(parentId)) {
        subtasksByParent.set(parentId, [])
      }
      subtasksByParent.get(parentId)!.push(sub)
    }

    return rows.map((row) => {
      const counts = subtaskCountMap.get(row.todoistItemId)
      const subtaskCount = counts?.subtaskCount ?? 0
      const completedSubtaskCount = counts?.completedSubtaskCount ?? 0
      const hasSubtasks = subtaskCount > 0
      const progressPercent = hasSubtasks
        ? Math.round((completedSubtaskCount / subtaskCount) * 100)
        : null

      const metadata = rowToGroupMetadata(row)
      const projectName = row.projectTodoistId ? projectNameMap.get(row.projectTodoistId) : null

      // Compute subtask points total
      const siblings = subtasksByParent.get(row.todoistItemId) ?? []
      const subtaskPointsTotal = siblings.reduce((sum, sub) => {
        return sum + calculateEstimatedPoints(sub, pointsSettings)
      }, 0)

      const completionBonusPoints = row.completionBonusPoints
      const estimatedPoints = subtaskPointsTotal + completionBonusPoints

      return {
        id: row.id,
        todoistTaskId: row.todoistItemId,
        projectId: row.projectTodoistId,
        projectName: projectName ?? null,
        title: row.title,
        deadline: formatDeadline(row.dueAt),
        hasSubtasks,
        subtaskCount,
        completedSubtaskCount,
        progressPercent,
        eligibleForProgressTracking: hasSubtasks,
        metadata,
        subtaskPointsTotal,
        completionBonusPoints,
        estimatedPoints,
        isCompleted: row.isCompleted,
        isDeadlineApproaching: isDeadlineApproaching(row.dueAt)
      }
    })
  },

  async buildEnrichedTaskDetail(userId: string, row: TaskWithMetaRow): Promise<EnrichedTaskDetail> {
    const [settings, subtaskRows] = await Promise.all([
      settingsRepository.findByUserId(userId),
      tasksRepository.getSubtasksWithMetaForTask(userId, row.todoistItemId)
    ])

    const pointsSettings = settings
      ? settingsToPointsSettings(settings)
      : getDefaultPointsSettings()

    // Compute per-subtask estimated points
    const subtasks: TaskSubtaskSummary[] = subtaskRows.map(sub => ({
      id: sub.id,
      todoistTaskId: sub.todoistItemId,
      title: sub.title,
      isCompleted: sub.isCompleted,
      earnedPoints: null,
      metadata: subtaskRowToMetadata(sub),
      estimatedPoints: calculateEstimatedPoints(sub, pointsSettings)
    }))

    const subtaskPointsTotal = subtasks.reduce((sum, s) => sum + s.estimatedPoints, 0)
    const completionBonusPoints = row.completionBonusPoints
    const estimatedPoints = subtaskPointsTotal + completionBonusPoints

    const metadata = rowToGroupMetadata(row)

    // Build subtask counts from loaded subtasks
    const subtaskCount = subtasks.length
    const completedSubtaskCount = subtasks.filter(s => s.isCompleted).length
    const hasSubtasks = subtaskCount > 0
    const progressPercent = hasSubtasks
      ? Math.round((completedSubtaskCount / subtaskCount) * 100)
      : null

    const enriched: EnrichedTask = {
      id: row.id,
      todoistTaskId: row.todoistItemId,
      projectId: row.projectTodoistId,
      projectName: null, // not needed for detail view
      title: row.title,
      deadline: formatDeadline(row.dueAt),
      hasSubtasks,
      subtaskCount,
      completedSubtaskCount,
      progressPercent,
      eligibleForProgressTracking: hasSubtasks,
      metadata,
      subtaskPointsTotal,
      completionBonusPoints,
      estimatedPoints,
      isCompleted: row.isCompleted,
      isDeadlineApproaching: isDeadlineApproaching(row.dueAt)
    }

    return { ...enriched, subtasks }
  }
}
