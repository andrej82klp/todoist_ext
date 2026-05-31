import type {
  DashboardNotification,
  DashboardNotificationAcknowledgementResult,
  DashboardSummary,
  DashboardTaskSummary,
  DashboardRewardProgress,
  EnrichedTask,
  StreakSummary
} from '../../../shared/types'
import { dashboardRepository } from '../../repositories/dashboard'
import { ledgerRepository } from '../../repositories/ledger'
import { rewardsRepository } from '../../repositories/rewards'
import { settingsRepository } from '../../repositories/settings'
import { tasksRepository } from '../../repositories/tasks'
import { notFoundError } from '../../utils/api'
import { pointsEngineService } from '../points/pointsEngineService'
import { streakService, yesterdayUtc } from '../streaks/streakService'
import { taskAssemblyService } from '../tasks/taskAssemblyService'

type MilestoneRow = Awaited<ReturnType<typeof settingsRepository.findMilestonesByUserId>>[number]
type NotificationRow = Awaited<ReturnType<typeof dashboardRepository.listActiveNotificationsByUserId>>[number]

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function mapStreakSummary(
  settings: Awaited<ReturnType<typeof settingsRepository.findByUserId>>,
  milestones: MilestoneRow[],
  state: Awaited<ReturnType<typeof settingsRepository.findStreakStateByUserId>>,
  protection: Awaited<ReturnType<typeof settingsRepository.findStreakProtectionByUserId>>
): StreakSummary {
  const current = state?.currentStreak ?? 0
  const nextMilestone = [...milestones]
    .filter(milestone => milestone.isActive && milestone.days > current)
    .sort((left, right) => left.days - right.days)[0] ?? null

  return {
    current,
    longest: state?.longestStreak ?? 0,
    protectionBalance: protection?.balance ?? 0,
    ruleType: settings?.streakRuleType ?? 'completed_items',
    ruleValue: settings?.streakRuleValue ?? 1,
    nextMilestone: nextMilestone
      ? {
          days: nextMilestone.days,
          remainingDays: Math.max(0, nextMilestone.days - current)
        }
      : null
  }
}

function mapTodayTask(task: EnrichedTask): DashboardTaskSummary {
  return {
    id: task.id,
    todoistTaskId: task.todoistTaskId,
    title: task.title,
    deadline: task.deadline,
    badge: task.metadata.badge,
    estimatedPoints: task.estimatedPoints,
    progressPercent: task.progressPercent
  }
}

function sortTodayTasks(left: EnrichedTask, right: EnrichedTask) {
  const leftDeadline = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
  const rightDeadline = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY

  if (leftDeadline !== rightDeadline) {
    return leftDeadline - rightDeadline
  }

  if (left.estimatedPoints !== right.estimatedPoints) {
    return right.estimatedPoints - left.estimatedPoints
  }

  return left.title.localeCompare(right.title)
}

function selectTodayTasks(tasks: EnrichedTask[]): DashboardTaskSummary[] {
  const cutoff = todayKey()

  return tasks
    .filter(task => !task.isCompleted && task.deadline !== null && task.deadline <= cutoff)
    .sort(sortTodayTasks)
    .slice(0, 5)
    .map(mapTodayTask)
}

function mapRewardProgress(
  rows: Awaited<ReturnType<typeof rewardsRepository.listByUserId>>,
  currentBalance: number
): DashboardRewardProgress {
  const closestReward = [...rows]
    .filter(reward => !reward.isArchived)
    .map(reward => ({
      id: reward.id,
      name: reward.name,
      costPoints: reward.costPoints,
      pointsNeeded: Math.max(0, reward.costPoints - currentBalance),
      createdAt: reward.createdAt
    }))
    .sort((left, right) => {
      if (left.pointsNeeded !== right.pointsNeeded) {
        return left.pointsNeeded - right.pointsNeeded
      }

      if (left.costPoints !== right.costPoints) {
        return left.costPoints - right.costPoints
      }

      return left.createdAt.getTime() - right.createdAt.getTime()
    })[0] ?? null

  return {
    closestReward: closestReward
      ? {
          id: closestReward.id,
          name: closestReward.name,
          costPoints: closestReward.costPoints,
          pointsNeeded: closestReward.pointsNeeded
        }
      : null
  }
}

function mapNotification(row: NotificationRow): DashboardNotification {
  return {
    id: row.id,
    type: row.notificationType,
    severity: row.severity,
    title: row.title,
    message: row.message,
    requiresAcknowledgement: row.acknowledgedAt === null,
    createdAt: row.createdAt.toISOString()
  }
}

export const dashboardService = {
  async getDashboard(userId: string): Promise<DashboardSummary> {
    await settingsRepository.ensureDefaults(userId)

    // Catch up any unevaluated days so the streak summary and protection
    // banners are current before we read them.
    await streakService.ensureEvaluatedThroughDate(userId, yesterdayUtc())

    const [
      balanceRow,
      recentLedgerRows,
      settings,
      milestones,
      streakState,
      streakProtection,
      taskRows,
      rewardRows,
      notificationRows
    ] = await Promise.all([
      ledgerRepository.getBalanceByUserId(userId),
      ledgerRepository.listByUserIdPaginated(userId, 1, 5),
      settingsRepository.findByUserId(userId),
      settingsRepository.findMilestonesByUserId(userId),
      settingsRepository.findStreakStateByUserId(userId),
      settingsRepository.findStreakProtectionByUserId(userId),
      tasksRepository.findTasksWithMeta(userId, { includeCompleted: false }),
      rewardsRepository.listByUserId(userId),
      dashboardRepository.listActiveNotificationsByUserId(userId, 5)
    ])

    const enrichedTasks = await taskAssemblyService.buildEnrichedTaskList(userId, taskRows)
    const points = pointsEngineService.balanceRowToSummary(balanceRow)

    return {
      points,
      streak: mapStreakSummary(settings, milestones, streakState, streakProtection),
      todayTasks: selectTodayTasks(enrichedTasks),
      recentTransactions: recentLedgerRows.map(row => pointsEngineService.ledgerRowToDomain(row)),
      rewardProgress: mapRewardProgress(rewardRows, points.currentBalance),
      notifications: notificationRows.map(mapNotification)
    }
  },

  async acknowledgeNotification(userId: string, notificationId: string): Promise<DashboardNotificationAcknowledgementResult> {
    const notification = await dashboardRepository.acknowledgeNotification(userId, notificationId)

    if (!notification) {
      throw notFoundError('Notification not found')
    }

    return {
      success: true,
      notificationId: notification.id
    }
  }
}
