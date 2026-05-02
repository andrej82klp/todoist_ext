import { and, desc, eq, lte, sql } from 'drizzle-orm'

import type { DatabaseClient } from '../db/client'
import { getDb } from '../db/client'
import {
  dashboardNotifications,
  milestoneAwards,
  milestoneDefinitions,
  streakHistory,
  streakProtection,
  streakState
} from '../db/schema'

export type StreakStateRow = typeof streakState.$inferSelect
export type StreakProtectionRow = typeof streakProtection.$inferSelect
export type StreakHistoryRow = typeof streakHistory.$inferSelect
export type MilestoneDefinitionRow = typeof milestoneDefinitions.$inferSelect
export type MilestoneAwardRow = typeof milestoneAwards.$inferSelect

export interface UpdateStateInput {
  currentStreak?: number
  longestStreak?: number
  lastQualifiedDate?: string | null
  lastEvaluatedDate?: string
  lastProtectionUsedDate?: string | null
}

export interface UpdateProtectionInput {
  balance?: number
  lastRewardedAt?: Date | null
}

export interface CreateMilestoneAwardInput {
  userId: string
  milestoneDefinitionId: string
  awardedForDays: number
  ledgerTransactionId: string | null
}

export interface CreateProtectionNotificationInput {
  userId: string
  protectedDate: string
  remainingBalance: number
}

export const streaksRepository = {
  // ── Non-transaction reads ──────────────────────────────────────────────────

  async findStateByUserId(userId: string): Promise<StreakStateRow | null> {
    const db = getDb()
    const [row] = await db.select().from(streakState).where(eq(streakState.userId, userId)).limit(1)
    return row ?? null
  },

  async findProtectionByUserId(userId: string): Promise<StreakProtectionRow | null> {
    const db = getDb()
    const [row] = await db.select().from(streakProtection).where(eq(streakProtection.userId, userId)).limit(1)
    return row ?? null
  },

  async findHistoryByUserIdAndDate(userId: string, activityDate: string): Promise<StreakHistoryRow | null> {
    const db = getDb()
    const [row] = await db.select().from(streakHistory)
      .where(and(eq(streakHistory.userId, userId), eq(streakHistory.activityDate, activityDate)))
      .limit(1)
    return row ?? null
  },

  async findMilestonesByUserId(userId: string): Promise<MilestoneDefinitionRow[]> {
    const db = getDb()
    return db.select().from(milestoneDefinitions).where(eq(milestoneDefinitions.userId, userId))
  },

  // ── Transaction-aware reads ────────────────────────────────────────────────

  async findStateByUserIdInTransaction(tx: DatabaseClient, userId: string): Promise<StreakStateRow | null> {
    const [row] = await tx.select().from(streakState).where(eq(streakState.userId, userId)).limit(1)
    return row ?? null
  },

  async findProtectionByUserIdInTransaction(tx: DatabaseClient, userId: string): Promise<StreakProtectionRow | null> {
    const [row] = await tx.select().from(streakProtection).where(eq(streakProtection.userId, userId)).limit(1)
    return row ?? null
  },

  async findHistoryByUserIdAndDateInTransaction(tx: DatabaseClient, userId: string, activityDate: string): Promise<StreakHistoryRow | null> {
    const [row] = await tx.select().from(streakHistory)
      .where(and(eq(streakHistory.userId, userId), eq(streakHistory.activityDate, activityDate)))
      .limit(1)
    return row ?? null
  },

  async findMilestonesByUserIdInTransaction(tx: DatabaseClient, userId: string): Promise<MilestoneDefinitionRow[]> {
    return tx.select().from(milestoneDefinitions).where(eq(milestoneDefinitions.userId, userId))
  },

  async listRecentQualifiedHistoryInTransaction(tx: DatabaseClient, userId: string, endDate: string, limit: number): Promise<StreakHistoryRow[]> {
    return tx.select().from(streakHistory)
      .where(and(
        eq(streakHistory.userId, userId),
        eq(streakHistory.qualified, true),
        lte(streakHistory.activityDate, endDate)
      ))
      .orderBy(desc(streakHistory.activityDate))
      .limit(limit)
  },

  async findAwardByUserIdAndMilestoneIdInTransaction(
    tx: DatabaseClient,
    userId: string,
    milestoneDefinitionId: string
  ): Promise<MilestoneAwardRow | null> {
    const [row] = await tx.select().from(milestoneAwards)
      .where(and(
        eq(milestoneAwards.userId, userId),
        eq(milestoneAwards.milestoneDefinitionId, milestoneDefinitionId)
      ))
      .limit(1)
    return row ?? null
  },

  async findProtectionNotificationByUserIdAndProtectedDateInTransaction(
    tx: DatabaseClient,
    userId: string,
    protectedDate: string
  ) {
    const rows = await tx.select().from(dashboardNotifications)
      .where(and(
        eq(dashboardNotifications.userId, userId),
        eq(dashboardNotifications.notificationType, 'streak_protection_used'),
        sql`${dashboardNotifications.payload}->>'protectedDate' = ${protectedDate}`
      ))
    return rows[0] ?? null
  },

  // ── Transaction-aware writes ───────────────────────────────────────────────

  async upsertHistoryIncrementAggregatesInTransaction(
    tx: DatabaseClient,
    userId: string,
    activityDate: string,
    pointsEarnedDelta: number,
    completedCountDelta: number
  ): Promise<void> {
    const safePoints = Math.max(0, pointsEarnedDelta)
    const safeCount = Math.max(0, completedCountDelta)

    await tx.insert(streakHistory)
      .values({
        userId,
        activityDate,
        qualified: false,
        pointsEarned: safePoints,
        completedCount: safeCount
      })
      .onConflictDoUpdate({
        target: [streakHistory.userId, streakHistory.activityDate],
        set: {
          pointsEarned: sql`${streakHistory.pointsEarned} + ${safePoints}`,
          completedCount: sql`${streakHistory.completedCount} + ${safeCount}`,
          updatedAt: new Date()
        }
      })
  },

  async upsertHistoryEvaluationResultInTransaction(
    tx: DatabaseClient,
    userId: string,
    activityDate: string,
    data: {
      qualified: boolean
      qualifiedBy: string | null
      streakLength: number
      protectionConsumed: boolean
      pointsEarned: number
      completedCount: number
    }
  ): Promise<void> {
    await tx.insert(streakHistory)
      .values({
        userId,
        activityDate,
        qualified: data.qualified,
        qualifiedBy: data.qualifiedBy,
        streakLength: data.streakLength,
        protectionConsumed: data.protectionConsumed,
        pointsEarned: data.pointsEarned,
        completedCount: data.completedCount
      })
      .onConflictDoUpdate({
        target: [streakHistory.userId, streakHistory.activityDate],
        set: {
          qualified: data.qualified,
          qualifiedBy: data.qualifiedBy,
          streakLength: data.streakLength,
          protectionConsumed: data.protectionConsumed,
          updatedAt: new Date()
        }
      })
  },

  async updateStateInTransaction(tx: DatabaseClient, userId: string, updates: UpdateStateInput): Promise<void> {
    await tx.update(streakState)
      .set({
        ...(updates.currentStreak !== undefined && { currentStreak: updates.currentStreak }),
        ...(updates.longestStreak !== undefined && { longestStreak: updates.longestStreak }),
        ...(updates.lastQualifiedDate !== undefined && { lastQualifiedDate: updates.lastQualifiedDate }),
        ...(updates.lastEvaluatedDate !== undefined && { lastEvaluatedDate: updates.lastEvaluatedDate }),
        ...(updates.lastProtectionUsedDate !== undefined && { lastProtectionUsedDate: updates.lastProtectionUsedDate }),
        updatedAt: new Date()
      })
      .where(eq(streakState.userId, userId))
  },

  async updateProtectionInTransaction(tx: DatabaseClient, userId: string, updates: UpdateProtectionInput): Promise<void> {
    await tx.update(streakProtection)
      .set({
        ...(updates.balance !== undefined && { balance: updates.balance }),
        ...(updates.lastRewardedAt !== undefined && { lastRewardedAt: updates.lastRewardedAt }),
        updatedAt: new Date()
      })
      .where(eq(streakProtection.userId, userId))
  },

  async createMilestoneAwardInTransaction(tx: DatabaseClient, input: CreateMilestoneAwardInput): Promise<MilestoneAwardRow | null> {
    const [row] = await tx.insert(milestoneAwards)
      .values({
        userId: input.userId,
        milestoneDefinitionId: input.milestoneDefinitionId,
        awardedForDays: input.awardedForDays,
        ledgerTransactionId: input.ledgerTransactionId
      })
      .onConflictDoNothing()
      .returning()
    return row ?? null
  },

  async createProtectionNotificationInTransaction(tx: DatabaseClient, input: CreateProtectionNotificationInput) {
    const [row] = await tx.insert(dashboardNotifications)
      .values({
        userId: input.userId,
        notificationType: 'streak_protection_used',
        severity: 'warning',
        title: 'Streak protected',
        message: `Your streak was protected on ${input.protectedDate}. ${input.remainingBalance} protection day${input.remainingBalance === 1 ? '' : 's'} remaining.`,
        payload: { protectedDate: input.protectedDate, remainingBalance: input.remainingBalance }
      })
      .returning()
    return row!
  }
}
