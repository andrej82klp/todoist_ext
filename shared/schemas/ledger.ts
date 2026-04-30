import { z } from 'zod'

export const manualLedgerAdjustmentSchema = z.object({
  amount: z.coerce.number().int().refine(value => value !== 0, {
    message: 'Amount must be non-zero'
  }),
  reason: z.string().trim().min(1),
  description: z.string().trim().min(1).max(500).optional(),
  relatedEntityType: z.string().trim().min(1).max(64).optional(),
  relatedEntityId: z.string().trim().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict()
