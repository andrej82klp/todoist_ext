import { z } from 'zod'

import { STREAK_BONUS_STRATEGIES, STREAK_RULE_TYPES } from '../constants/api'

const priorityMultipliersPatchSchema = z.object({
  low: z.coerce.number().positive().optional(),
  medium: z.coerce.number().positive().optional(),
  high: z.coerce.number().positive().optional()
}).strict()

const pointsPatchSchema = z.object({
  difficultyMultiplierBase: z.coerce.number().int().positive().optional(),
  priorityMultipliers: priorityMultipliersPatchSchema.optional()
}).strict()

export const milestoneDefinitionSchema = z.object({
  days: z.coerce.number().int().positive(),
  fixedBonusPoints: z.coerce.number().int().nonnegative().default(0),
  percentageBonus: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().default(true)
}).strict()

const streakPatchSchema = z.object({
  ruleType: z.enum(STREAK_RULE_TYPES).optional(),
  ruleValue: z.coerce.number().int().positive().optional(),
  protectionEnabled: z.boolean().optional(),
  startingProtectionBalance: z.coerce.number().int().nonnegative().optional(),
  protectionRewardEveryNDays: z.coerce.number().int().positive().optional(),
  protectionRewardAmount: z.coerce.number().int().nonnegative().optional(),
  bonusStrategy: z.enum(STREAK_BONUS_STRATEGIES).optional(),
  milestonePercentageWindowDays: z.coerce.number().int().positive().optional(),
  milestones: z.array(milestoneDefinitionSchema).min(1)
    .refine(
      (items) => {
        return new Set(items.map(i => i.days)).size === items.length
      },
      { message: 'Milestone days must be unique' }
    )
    .optional()
}).strict()

export const settingsPatchBodySchema = z.object({
  points: pointsPatchSchema.optional(),
  streak: streakPatchSchema.optional()
}).strict().refine(
  (data) => {
    const pCount = data.points ? Object.keys(data.points).length : 0
    const sCount = data.streak ? Object.keys(data.streak).length : 0
    return pCount > 0 || sCount > 0
  },
  {
    message: 'At least one settings section must include at least one field',
    path: ['_root']
  }
)

export type SettingsPatchBody = z.infer<typeof settingsPatchBodySchema>
