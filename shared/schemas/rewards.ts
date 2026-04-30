import { z } from 'zod'

import { nullableTrimmedStringSchema } from './common'

export const rewardCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: nullableTrimmedStringSchema.optional().default(null),
  category: nullableTrimmedStringSchema.optional().default(null),
  costPoints: z.coerce.number().int().positive()
}).strict()

export const rewardUpdateSchema = rewardCreateSchema.partial().refine(
  payload => Object.keys(payload).length > 0,
  {
    message: 'At least one reward field must be provided',
    path: ['_root']
  }
)
