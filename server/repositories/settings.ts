import { eq } from 'drizzle-orm'

import type { DatabaseClient } from '../db/client'
import { ensureUserDefaults } from '../db/defaults'
import { getDb } from '../db/client'
import { globalSettings, milestoneDefinitions, pointBalances, streakProtection, streakState } from '../db/schema'

export type MilestoneReplaceRow = {
  days: number
  fixedBonusPoints: number
  percentageBonus: string
  isActive: boolean
}

export const settingsRepository = {
  async ensureDefaults(userId: string) {
    return ensureUserDefaults(userId)
  },

  async findByUserId(userId: string) {
    const db = getDb()
    const [settings] = await db.select().from(globalSettings).where(eq(globalSettings.userId, userId)).limit(1)

    return settings ?? null
  },

  async findByUserIdInTransaction(tx: DatabaseClient, userId: string) {
    const [settings] = await tx.select().from(globalSettings).where(eq(globalSettings.userId, userId)).limit(1)

    return settings ?? null
  },

  async findMilestonesByUserId(userId: string) {
    const db = getDb()

    return db.select().from(milestoneDefinitions).where(eq(milestoneDefinitions.userId, userId))
  },

  async findPointBalanceByUserId(userId: string) {
    const db = getDb()
    const [balance] = await db.select().from(pointBalances).where(eq(pointBalances.userId, userId)).limit(1)

    return balance ?? null
  },

  async findStreakStateByUserId(userId: string) {
    const db = getDb()
    const [state] = await db.select().from(streakState).where(eq(streakState.userId, userId)).limit(1)

    return state ?? null
  },

  async findStreakProtectionByUserId(userId: string) {
    const db = getDb()
    const [protection] = await db.select().from(streakProtection).where(eq(streakProtection.userId, userId)).limit(1)

    return protection ?? null
  },

  async updateGlobalSettings(userId: string, updates: Partial<typeof globalSettings.$inferInsert>) {
    const db = getDb()
    await db.update(globalSettings)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(globalSettings.userId, userId))
  },

  async replaceMilestones(userId: string, milestones: MilestoneReplaceRow[]) {
    const db = getDb()
    await db.transaction(async (tx) => {
      await tx.delete(milestoneDefinitions).where(eq(milestoneDefinitions.userId, userId))
      if (milestones.length > 0) {
        await tx.insert(milestoneDefinitions).values(
          milestones.map(m => ({
            userId,
            days: m.days,
            fixedBonusPoints: m.fixedBonusPoints,
            percentageBonus: m.percentageBonus,
            isActive: m.isActive
          }))
        )
      }
    })
  }
}
