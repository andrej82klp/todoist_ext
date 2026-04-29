import { eq } from 'drizzle-orm'

import { ensureUserDefaults } from '../db/defaults'
import { getDb } from '../db/client'
import { globalSettings, milestoneDefinitions, pointBalances, streakProtection, streakState } from '../db/schema'

export const settingsRepository = {
  async ensureDefaults(userId: string) {
    return ensureUserDefaults(userId)
  },

  async findByUserId(userId: string) {
    const db = getDb()
    const [settings] = await db.select().from(globalSettings).where(eq(globalSettings.userId, userId)).limit(1)

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
  }
}
