import type { PriorityLevel } from '../../../shared/types'

interface PointsCalculationInput {
  priority: PriorityLevel
  difficulty: number
  customPointOverride?: number | null
}

interface PointsSettings {
  difficultyMultiplierBase: number
  lowPriorityMultiplier: number
  mediumPriorityMultiplier: number
  highPriorityMultiplier: number
}

export function calculateEstimatedPoints(
  task: PointsCalculationInput,
  settings: PointsSettings
): number {
  if (task.customPointOverride != null) {
    return task.customPointOverride
  }

  const multiplier = {
    low: settings.lowPriorityMultiplier,
    medium: settings.mediumPriorityMultiplier,
    high: settings.highPriorityMultiplier
  }[task.priority]

  return Math.round(task.difficulty * settings.difficultyMultiplierBase * multiplier)
}

export function isDeadlineApproaching(dueAt: Date | null): boolean {
  if (!dueAt) return false
  const now = Date.now()
  const deadline = dueAt.getTime()
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000
  return deadline <= now + twoDaysMs
}

export function getDefaultPointsSettings(): PointsSettings {
  return {
    difficultyMultiplierBase: 10,
    lowPriorityMultiplier: 1.0,
    mediumPriorityMultiplier: 1.25,
    highPriorityMultiplier: 1.5
  }
}

export function settingsToPointsSettings(settings: {
  difficultyMultiplierBase: number
  lowPriorityMultiplier: string
  mediumPriorityMultiplier: string
  highPriorityMultiplier: string
}): PointsSettings {
  return {
    difficultyMultiplierBase: settings.difficultyMultiplierBase,
    lowPriorityMultiplier: Number(settings.lowPriorityMultiplier),
    mediumPriorityMultiplier: Number(settings.mediumPriorityMultiplier),
    highPriorityMultiplier: Number(settings.highPriorityMultiplier)
  }
}
