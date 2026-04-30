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

export interface TodoistTaskMetadata {
  priority: PriorityLevel
  difficulty: number
  timeEstimateMinutes: number | null
  completionBonusEnabled: boolean
  completionBonusPercent: number
  badge: string | null
  customPointOverride: number | null
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
  metadata: TodoistTaskMetadata
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
  defaultCompletionBonusEnabled: boolean
  defaultCompletionBonusPercent: number
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
