import { z } from 'zod'

import { STREAK_BONUS_STRATEGIES, STREAK_RULE_TYPES } from '../constants/api'

const milestoneDefinitionSchema = z.object({
  days: z.coerce.number().int().positive(),
  fixedBonusPoints: z.coerce.number().int().nonnegative().default(0),
  percentageBonus: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().default(true)
}).strict()

export const settingsUpdateSchema = z.object({
  difficultyMultiplierBase: z.coerce.number().int().positive().optional(),
  lowPriorityMultiplier: z.coerce.number().positive().optional(),
  mediumPriorityMultiplier: z.coerce.number().positive().optional(),
  highPriorityMultiplier: z.coerce.number().positive().optional(),
  completionBonusPercent: z.coerce.number().min(0).optional(),
  streakRuleType: z.enum(STREAK_RULE_TYPES).optional(),
  streakRuleValue: z.coerce.number().int().positive().optional(),
  streakProtectionEnabled: z.boolean().optional(),
  streakProtectionStartingBalance: z.coerce.number().int().nonnegative().optional(),
  protectionRewardEveryNDays: z.coerce.number().int().positive().optional(),
  protectionRewardAmount: z.coerce.number().int().nonnegative().optional(),
  milestoneBonusStrategy: z.enum(STREAK_BONUS_STRATEGIES).optional(),
  milestonePercentageWindowDays: z.coerce.number().int().positive().optional(),
  milestones: z.array(milestoneDefinitionSchema).min(1).optional()
}).strict().refine(
  payload => Object.keys(payload).length > 0,
  {
    message: 'At least one settings field must be provided',
    path: ['_root']
  }
)
