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
