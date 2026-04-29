import { desc, eq } from 'drizzle-orm'

import { getDb } from '../db/client'
import { pointLedger } from '../db/schema'

export interface CreateLedgerTransactionInput {
  userId: string
  transactionType: 'earned' | 'spent' | 'bonus' | 'adjusted'
  amount: number
  description: string
  source: string
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  idempotencyKey?: string | null
  metadata?: Record<string, unknown>
}

export const ledgerRepository = {
  async createTransaction(input: CreateLedgerTransactionInput) {
    const db = getDb()
    const [transaction] = await db.insert(pointLedger).values({
      userId: input.userId,
      transactionType: input.transactionType,
      amount: input.amount,
      description: input.description,
      source: input.source,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {}
    }).returning()

    return transaction
  },

  async listByUserId(userId: string) {
    const db = getDb()

    return db.select().from(pointLedger).where(eq(pointLedger.userId, userId)).orderBy(desc(pointLedger.createdAt))
  }
}
