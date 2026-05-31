export type PriorityLevel = 'low' | 'medium' | 'high'

export type StreakBonusStrategy = 'fixed' | 'percentage'

export type LedgerTransactionType = 'earned' | 'spent' | 'bonus' | 'adjusted'

export type StreakRuleType = 'completed_items' | 'points'

export interface RewardAffordability {
  canRedeem: boolean
  missingPoints: number
}

export interface Reward {
  id: string
  name: string
  description: string | null
  category: string | null
  costPoints: number
  isArchived: boolean
  affordability?: RewardAffordability
  createdAt: string
  updatedAt: string
}

export interface RedemptionRecord {
  id: string
  rewardId: string
  rewardName: string
  costPoints: number
  redeemedAt: string
}

export interface RewardRedemptionResult {
  success: true
  redemption: RedemptionRecord
  points: PointsSummary
}

export interface PointsSummary {
  currentBalance: number
  lifetimeEarned: number
  lifetimeSpent: number
}

export interface StreakSummary {
  current: number
  longest: number
  protectionBalance: number
  ruleType: StreakRuleType
  ruleValue: number
  nextMilestone: {
    days: number
    remainingDays: number
  } | null
}

export interface DashboardTaskSummary {
  id: string
  todoistTaskId: string
  title: string
  deadline: string | null
  badge: string | null
  estimatedPoints: number
  progressPercent: number | null
}

export interface DashboardRewardProgress {
  closestReward: {
    id: string
    name: string
    costPoints: number
    pointsNeeded: number
  } | null
}

export interface DashboardNotification {
  id: string
  type: 'streak_protection_used' | 'system'
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  requiresAcknowledgement: boolean
  createdAt: string
}

export interface DashboardNotificationAcknowledgementResult {
  success: true
  notificationId: string
}

export interface DashboardSummary {
  points: PointsSummary
  streak: StreakSummary
  todayTasks: DashboardTaskSummary[]
  recentTransactions: LedgerTransaction[]
  rewardProgress: DashboardRewardProgress
  notifications: DashboardNotification[]
}

export interface TodoistTaskMetadata {
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
  completionBonusEnabled: boolean
  completionBonusPercent: number
  badge: string | null
  customPointOverride: number | null
}

export interface TaskGroupMetadata {
  badge: string | null
  completionBonusPoints: number
}

export interface SubtaskMetadata {
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
}

export interface LedgerTransaction {
  id: string
  type: LedgerTransactionType
  amount: number
  description: string
  source: string
  relatedEntityType: string | null
  relatedEntityId: string | null
  createdAt: string
}

export interface SessionUser {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  timezone: string | null
}

export interface AuthSessionState {
  authenticated: boolean
  user: SessionUser | null
  initialSyncCompleted: boolean
}

export interface TaskSubtaskSummary {
  id: string
  todoistTaskId: string
  title: string
  isCompleted: boolean
  earnedPoints: number | null
  metadata: SubtaskMetadata
  estimatedPoints: number
}

export interface TaskListProjectOption {
  id: string
  name: string
}

export interface TaskListMeta {
  page: number
  pageSize: number
  total: number
  availableProjects: TaskListProjectOption[]
}

export interface EnrichedTask {
  id: string
  todoistTaskId: string
  projectId: string | null
  projectName: string | null
  title: string
  deadline: string | null
  hasSubtasks: boolean
  subtaskCount: number
  completedSubtaskCount: number
  progressPercent: number | null
  eligibleForProgressTracking: boolean
  metadata: TaskGroupMetadata
  subtaskPointsTotal: number
  completionBonusPoints: number
  estimatedPoints: number
  isCompleted: boolean
  isDeadlineApproaching: boolean
}

export interface EnrichedTaskDetail extends EnrichedTask {
  subtasks: TaskSubtaskSummary[]
}

export interface SettingsMilestoneDefinition {
  days: number
  fixedBonusPoints: number
  percentageBonus: number
  isActive: boolean
}

export interface GlobalSettingsPoints {
  difficultyMultiplierBase: number
  priorityMultipliers: {
    low: number
    medium: number
    high: number
  }
}

export interface GlobalSettingsStreak {
  ruleType: StreakRuleType
  ruleValue: number
  protectionEnabled: boolean
  startingProtectionBalance: number
  protectionRewardEveryNDays: number
  protectionRewardAmount: number
  bonusStrategy: StreakBonusStrategy
  milestonePercentageWindowDays: number
  milestones: SettingsMilestoneDefinition[]
}

export interface GlobalSettingsResponse {
  points: GlobalSettingsPoints
  streak: GlobalSettingsStreak
}

export interface AnalyticsProjectSummary {
  projectId: string
  projectName: string
  pointsEarned: number
}

export interface AnalyticsStreakHistorySummary {
  current: number
  longest: number
  milestonesReached: number[]
}

export interface AnalyticsSummary {
  mostRewardingProjects: AnalyticsProjectSummary[]
  streakHistory: AnalyticsStreakHistorySummary
}
