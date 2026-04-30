import type { EnrichedTask, EnrichedTaskDetail, TaskSubtaskSummary, TodoistTaskMetadata } from '../../../shared/types'
import { settingsRepository } from '../../repositories/settings'
import type { TaskWithMetaRow } from '../../repositories/tasks'
import { tasksRepository } from '../../repositories/tasks'
import {
  calculateEstimatedPoints,
  getDefaultPointsSettings,
  isDeadlineApproaching,
  settingsToPointsSettings
} from './pointsCalculator'

function rowToMetadata(row: TaskWithMetaRow): TodoistTaskMetadata {
  return {
    priority: row.priority,
    difficulty: row.difficulty,
    timeEstimateMinutes: row.timeEstimateMinutes,
    completionBonusEnabled: row.completionBonusEnabled,
    completionBonusPercent: row.completionBonusPercent,
    badge: row.badge,
    customPointOverride: row.customPointOverride
  }
}

function formatDeadline(dueAt: Date | null): string | null {
  if (!dueAt) return null
  return dueAt.toISOString().slice(0, 10)
}

export const taskAssemblyService = {
  async buildEnrichedTaskList(userId: string, rows: TaskWithMetaRow[]): Promise<EnrichedTask[]> {
    if (rows.length === 0) return []

    const [settings, subtaskCounts, projectNames] = await Promise.all([
      settingsRepository.findByUserId(userId),
      tasksRepository.getSubtaskCounts(userId, rows.map(r => r.todoistItemId)),
      tasksRepository.getProjectNames(userId, [...new Set(rows.map(r => r.projectTodoistId).filter(Boolean) as string[])])
    ])

    const pointsSettings = settings
      ? settingsToPointsSettings(settings)
      : getDefaultPointsSettings()

    const subtaskCountMap = new Map(
      subtaskCounts.map(s => [s.parentTodoistItemId, s])
    )

    const projectNameMap = new Map(
      projectNames.map(p => [p.todoistItemId, { id: p.id, name: p.title }])
    )

    return rows.map((row) => {
      const counts = subtaskCountMap.get(row.todoistItemId)
      const subtaskCount = counts?.subtaskCount ?? 0
      const completedSubtaskCount = counts?.completedSubtaskCount ?? 0
      const hasSubtasks = subtaskCount > 0
      const progressPercent = hasSubtasks
        ? Math.round((completedSubtaskCount / subtaskCount) * 100)
        : null

      const metadata = rowToMetadata(row)
      const estimatedPoints = calculateEstimatedPoints(metadata, pointsSettings)
      const project = row.projectTodoistId ? projectNameMap.get(row.projectTodoistId) : null

      return {
        id: row.id,
        todoistTaskId: row.todoistItemId,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        title: row.title,
        deadline: formatDeadline(row.dueAt),
        hasSubtasks,
        subtaskCount,
        completedSubtaskCount,
        progressPercent,
        eligibleForProgressTracking: hasSubtasks,
        metadata,
        estimatedPoints,
        isCompleted: row.isCompleted,
        isDeadlineApproaching: isDeadlineApproaching(row.dueAt)
      }
    })
  },

  async buildEnrichedTaskDetail(userId: string, row: TaskWithMetaRow): Promise<EnrichedTaskDetail> {
    const [enrichedList, subtaskRows] = await Promise.all([
      this.buildEnrichedTaskList(userId, [row]),
      tasksRepository.getSubtasksForTask(userId, row.todoistItemId)
    ])

    const enriched = enrichedList[0]!

    const subtasks: TaskSubtaskSummary[] = subtaskRows.map(sub => ({
      id: sub.id,
      todoistTaskId: sub.todoistItemId,
      title: sub.title,
      isCompleted: sub.isCompleted,
      earnedPoints: null
    }))

    return { ...enriched, subtasks }
  }
}
