import { z } from 'zod'

import { nullableIntegerSchema, nullableTrimmedStringSchema, priorityLevelSchema } from './common'

export const taskMetadataSchema = z.object({
  priority: priorityLevelSchema,
  difficulty: z.coerce.number().int().min(1).max(10),
  timeEstimateMinutes: nullableIntegerSchema.optional().default(null),
  completionBonusEnabled: z.boolean(),
  completionBonusPercent: z.coerce.number().min(0).max(100),
  badge: nullableTrimmedStringSchema.optional().default(null),
  customPointOverride: nullableIntegerSchema.optional().default(null)
}).strict()

export const taskMetadataUpdateSchema = taskMetadataSchema.partial().refine(
  payload => Object.keys(payload).length > 0,
  {
    message: 'At least one metadata field must be provided',
    path: ['_root']
  }
)
