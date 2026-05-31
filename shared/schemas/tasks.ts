import { z } from 'zod'

import { nullableIntegerSchema, nullableTrimmedStringSchema, priorityLevelSchema } from './common'

export const taskGroupMetadataSchema = z.object({
  badge: nullableTrimmedStringSchema.optional().default(null),
  completionBonusPoints: z.coerce.number().int().nonnegative()
}).strict()

export const subtaskMetadataSchema = z.object({
  priority: priorityLevelSchema,
  difficulty: z.coerce.number().int().min(1).max(10),
  timeEstimateMinutes: nullableIntegerSchema.optional().default(null)
}).strict()

export const taskGroupMetadataUpdateSchema = taskGroupMetadataSchema.partial().refine(
  payload => Object.keys(payload).length > 0,
  {
    message: 'At least one metadata field must be provided',
    path: ['_root']
  }
)

export const subtaskMetadataUpdateSchema = subtaskMetadataSchema.partial().refine(
  payload => Object.keys(payload).length > 0,
  {
    message: 'At least one metadata field must be provided',
    path: ['_root']
  }
)

export const batchGroupMetadataUpdateItemSchema = taskGroupMetadataSchema.extend({
  taskId: z.string().uuid()
})

export const batchGroupMetadataUpdateSchema = z.object({
  items: z.array(batchGroupMetadataUpdateItemSchema).min(1).max(50)
}).strict()

// Legacy aliases kept for backward compatibility during migration
/** @deprecated Use taskGroupMetadataSchema or subtaskMetadataSchema */
export const taskMetadataSchema = subtaskMetadataSchema
/** @deprecated Use taskGroupMetadataUpdateSchema or subtaskMetadataUpdateSchema */
export const taskMetadataUpdateSchema = subtaskMetadataUpdateSchema
/** @deprecated Use batchGroupMetadataUpdateSchema */
export const batchMetadataUpdateItemSchema = batchGroupMetadataUpdateItemSchema
/** @deprecated Use batchGroupMetadataUpdateSchema */
export const batchMetadataUpdateSchema = batchGroupMetadataUpdateSchema
