import { count, desc, eq, sql } from 'drizzle-orm'

import type { DatabaseClient } from '../db/client'
import { getDb } from '../db/client'
import { pointBalances, pointLedger } from '../db/schema'

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

async function applyBalanceDelta(
  tx: DatabaseClient,
  userId: string,
  transactionType: CreateLedgerTransactionInput['transactionType'],
  amount: number
) {
  const [existing] = await tx.select().from(pointBalances).where(eq(pointBalances.userId, userId)).limit(1)

  if (!existing) {
    let currentBalance = 0
    let lifetimeEarned = 0
    let lifetimeSpent = 0

    switch (transactionType) {
      case 'earned':
      case 'bonus':
        currentBalance = amount
        lifetimeEarned = amount
        break
      case 'spent':
        currentBalance = -amount
        lifetimeSpent = amount
        break
      case 'adjusted':
        currentBalance = amount
        break
    }

    await tx.insert(pointBalances).values({
      userId,
      currentBalance,
      lifetimeEarned,
      lifetimeSpent
    })

    const [balance] = await tx.select().from(pointBalances).where(eq(pointBalances.userId, userId)).limit(1)
    return balance!
  }

  switch (transactionType) {
    case 'earned':
    case 'bonus':
      await tx.update(pointBalances).set({
        currentBalance: sql`${pointBalances.currentBalance} + ${amount}`,
        lifetimeEarned: sql`${pointBalances.lifetimeEarned} + ${amount}`,
        updatedAt: new Date()
      }).where(eq(pointBalances.userId, userId))
      break
    case 'spent':
      await tx.update(pointBalances).set({
        currentBalance: sql`${pointBalances.currentBalance} - ${amount}`,
        lifetimeSpent: sql`${pointBalances.lifetimeSpent} + ${amount}`,
        updatedAt: new Date()
      }).where(eq(pointBalances.userId, userId))
      break
    case 'adjusted':
      await tx.update(pointBalances).set({
        currentBalance: sql`${pointBalances.currentBalance} + ${amount}`,
        updatedAt: new Date()
      }).where(eq(pointBalances.userId, userId))
      break
  }

  const [balance] = await tx.select().from(pointBalances).where(eq(pointBalances.userId, userId)).limit(1)
  return balance!
}

async function applyLedgerChange(tx: DatabaseClient, input: CreateLedgerTransactionInput) {
  const [transaction] = await tx.insert(pointLedger).values({
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

  const balance = await applyBalanceDelta(tx, input.userId, input.transactionType, input.amount)

  return { transaction: transaction!, balance }
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

  async createTransactionAndUpdateBalance(input: CreateLedgerTransactionInput) {
    const db = getDb()

    return db.transaction(async tx => applyLedgerChange(tx as unknown as DatabaseClient, input))
  },

  async createTransactionAndUpdateBalanceInTransaction(tx: DatabaseClient, input: CreateLedgerTransactionInput) {
    return applyLedgerChange(tx, input)
  },

  async listByUserId(userId: string) {
    const db = getDb()

    return db.select().from(pointLedger).where(eq(pointLedger.userId, userId)).orderBy(desc(pointLedger.createdAt))
  },

  async listByUserIdPaginated(userId: string, page: number, pageSize: number) {
    const db = getDb()
    const offset = (page - 1) * pageSize

    return db.select().from(pointLedger)
      .where(eq(pointLedger.userId, userId))
      .orderBy(desc(pointLedger.createdAt))
      .limit(pageSize)
      .offset(offset)
  },

  async countByUserId(userId: string) {
    const db = getDb()
    const [row] = await db.select({ count: count() }).from(pointLedger).where(eq(pointLedger.userId, userId))

    return row?.count ?? 0
  },

  async getBalanceByUserId(userId: string) {
    const db = getDb()
    const [row] = await db.select().from(pointBalances).where(eq(pointBalances.userId, userId)).limit(1)

    return row ?? null
  }
}
