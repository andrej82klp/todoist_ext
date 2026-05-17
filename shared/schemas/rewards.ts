import { z } from 'zod'

import {
  nullableTrimmedStringSchema,
  paginationQuerySchema,
  stringToBoolean
} from './common'

export const rewardCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: nullableTrimmedStringSchema.optional().default(null),
  category: nullableTrimmedStringSchema.optional().default(null),
  costPoints: z.coerce.number().int().positive()
}).strict()

export const rewardUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: nullableTrimmedStringSchema.optional(),
  category: nullableTrimmedStringSchema.optional(),
  costPoints: z.coerce.number().int().positive().optional(),
  isArchived: z.boolean().optional()
}).strict().refine(
  payload => Object.keys(payload).length > 0,
  {
    message: 'At least one reward field must be provided',
    path: ['_root']
  }
)

export const rewardsListQuerySchema = paginationQuerySchema.extend({
  includeArchived: z.preprocess(stringToBoolean, z.boolean().optional()).default(false)
}).strict()
