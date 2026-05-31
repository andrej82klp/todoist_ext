import type { DatabaseClient } from '../../db/client'
import { getDb } from '../../db/client'
import type { GlobalSettings } from '../../db/schema'
import { ledgerRepository } from '../../repositories/ledger'
import type { LedgerTransaction, PointsSummary, SubtaskMetadata } from '../../../shared/types'
import {
  calculateEstimatedPoints,
  getDefaultPointsSettings,
  settingsToPointsSettings
} from '../tasks/pointsCalculator'

/** Calculates subtask earned points from its priority/difficulty metadata. */
export function calculateTaskPoints(
  metadata: SubtaskMetadata,
  settingsRow: GlobalSettings | null
): number {
  const pointsSettings = settingsRow
    ? settingsToPointsSettings(settingsRow)
    : getDefaultPointsSettings()

  return calculateEstimatedPoints(metadata, pointsSettings)
}

/** @deprecated Use fixed completionBonusPoints from task group metadata instead. */
export function calculateCompletionBonus(basePoints: number, bonusPercent: number): number {
  if (bonusPercent <= 0) {
    return 0
  }

  return Math.round((basePoints * bonusPercent) / 100)
}

export interface AwardTaskCompletionInput {
  userId: string
  earnedAmount: number
  completionBonusEnabled: boolean
  completionBonusPercent: number
  description: string
  source: string
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  idempotencyKey?: string | null
  metadata?: Record<string, unknown>
}

export interface ManualAdjustmentInput {
  userId: string
  amount: number
  reason: string
  description?: string | undefined
  relatedEntityType?: string | undefined
  relatedEntityId?: string | undefined
  metadata?: Record<string, unknown> | undefined
}

export interface AwardTaskCompletionInTransactionInput extends AwardTaskCompletionInput {
  db: DatabaseClient
}

function balanceRowToSummary(row: { currentBalance: number, lifetimeEarned: number, lifetimeSpent: number }): PointsSummary {
  return {
    currentBalance: row.currentBalance,
    lifetimeEarned: row.lifetimeEarned,
    lifetimeSpent: row.lifetimeSpent
  }
}

function ledgerRowToDomain(row: {
  id: string
  transactionType: 'earned' | 'spent' | 'bonus' | 'adjusted'
  amount: number
  description: string
  source: string
  relatedEntityType: string | null
  relatedEntityId: string | null
  createdAt: Date
}): LedgerTransaction {
  return {
    id: row.id,
    type: row.transactionType,
    amount: row.amount,
    description: row.description,
    source: row.source,
    relatedEntityType: row.relatedEntityType,
    relatedEntityId: row.relatedEntityId,
    createdAt: row.createdAt.toISOString()
  }
}

export const pointsEngineService = {
  ledgerRowToDomain,

  balanceRowToSummary(row: { currentBalance: number, lifetimeEarned: number, lifetimeSpent: number } | null): PointsSummary {
    if (!row) {
      return {
        currentBalance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      }
    }

    return balanceRowToSummary(row)
  },

  async awardTaskCompletion(input: AwardTaskCompletionInput) {
    const db = getDb()

    return db.transaction(async (tx) => {
      const earnedResult = await ledgerRepository.createTransactionAndUpdateBalanceInTransaction(tx as unknown as DatabaseClient, {
        userId: input.userId,
        transactionType: 'earned',
        amount: input.earnedAmount,
        description: input.description,
        source: input.source,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        metadata: input.metadata ?? {}
      })

      let bonusResult: Awaited<ReturnType<typeof ledgerRepository.createTransactionAndUpdateBalanceInTransaction>> | null = null

      if (input.completionBonusEnabled && input.completionBonusPercent > 0) {
        const bonusAmount = calculateCompletionBonus(input.earnedAmount, input.completionBonusPercent)

        if (bonusAmount > 0) {
          bonusResult = await ledgerRepository.createTransactionAndUpdateBalanceInTransaction(tx as unknown as DatabaseClient, {
            userId: input.userId,
            transactionType: 'bonus',
            amount: bonusAmount,
            description: `Completion bonus (${input.completionBonusPercent}% of ${input.earnedAmount} pts)`,
            source: input.source,
            relatedEntityType: input.relatedEntityType ?? null,
            relatedEntityId: input.relatedEntityId ?? null,
            idempotencyKey: null,
            metadata: {
              ...input.metadata,
              kind: 'completion_bonus',
              baseEarnedAmount: input.earnedAmount,
              bonusPercent: input.completionBonusPercent
            }
          })
        }
      }

      const finalBalance = bonusResult?.balance ?? earnedResult.balance

      return {
        earnedTransaction: earnedResult.transaction,
        bonusTransaction: bonusResult?.transaction ?? null,
        pointsSummary: balanceRowToSummary(finalBalance)
      }
    })
  },

  async awardTaskCompletionInTransaction(input: AwardTaskCompletionInTransactionInput) {
    const earnedResult = await ledgerRepository.createTransactionAndUpdateBalanceInTransaction(input.db, {
      userId: input.userId,
      transactionType: 'earned',
      amount: input.earnedAmount,
      description: input.description,
      source: input.source,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {}
    })

    let bonusResult: Awaited<ReturnType<typeof ledgerRepository.createTransactionAndUpdateBalanceInTransaction>> | null = null

    if (input.completionBonusEnabled && input.completionBonusPercent > 0) {
      const bonusAmount = calculateCompletionBonus(input.earnedAmount, input.completionBonusPercent)

      if (bonusAmount > 0) {
        bonusResult = await ledgerRepository.createTransactionAndUpdateBalanceInTransaction(input.db, {
          userId: input.userId,
          transactionType: 'bonus',
          amount: bonusAmount,
          description: `Completion bonus (${input.completionBonusPercent}% of ${input.earnedAmount} pts)`,
          source: input.source,
          relatedEntityType: input.relatedEntityType ?? null,
          relatedEntityId: input.relatedEntityId ?? null,
          idempotencyKey: null,
          metadata: {
            ...input.metadata,
            kind: 'completion_bonus',
            baseEarnedAmount: input.earnedAmount,
            bonusPercent: input.completionBonusPercent
          }
        })
      }
    }

    const finalBalance = bonusResult?.balance ?? earnedResult.balance

    return {
      earnedTransaction: earnedResult.transaction,
      bonusTransaction: bonusResult?.transaction ?? null,
      pointsSummary: balanceRowToSummary(finalBalance)
    }
  },

  async applyManualAdjustment(input: ManualAdjustmentInput) {
    const description = input.description?.trim().length
      ? input.description!.trim()
      : `Manual adjustment: ${input.reason}`

    const metadata: Record<string, unknown> = {
      reason: input.reason,
      ...(input.metadata ?? {})
    }

    const { transaction, balance } = await ledgerRepository.createTransactionAndUpdateBalance({
      userId: input.userId,
      transactionType: 'adjusted',
      amount: input.amount,
      description,
      source: 'manual_adjustment',
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      idempotencyKey: null,
      metadata
    })

    return {
      transaction: ledgerRowToDomain(transaction),
      pointsSummary: balanceRowToSummary(balance)
    }
  }
}
