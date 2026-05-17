import { eq } from 'drizzle-orm'

import { getDb } from './client'
import { globalSettings, milestoneDefinitions, pointBalances, streakProtection, streakState } from './schema'

export const DEFAULT_MILESTONES = [
  { days: 7, fixedBonusPoints: 50, percentageBonus: '5.00' },
  { days: 14, fixedBonusPoints: 150, percentageBonus: '10.00' },
  { days: 30, fixedBonusPoints: 500, percentageBonus: '20.00' }
] as const

export async function ensureUserDefaults(userId: string) {
  const db = getDb()

  await db.insert(globalSettings).values({ userId }).onConflictDoNothing()
  await db.insert(pointBalances).values({ userId }).onConflictDoNothing()
  await db.insert(streakState).values({ userId }).onConflictDoNothing()
  await db.insert(streakProtection).values({ userId, balance: 3 }).onConflictDoNothing()

  const existingMilestones = await db.select().from(milestoneDefinitions).where(eq(milestoneDefinitions.userId, userId))
  if (existingMilestones.length === 0) {
    await db.insert(milestoneDefinitions).values(
      DEFAULT_MILESTONES.map(milestone => ({
        userId,
        days: milestone.days,
        fixedBonusPoints: milestone.fixedBonusPoints,
        percentageBonus: milestone.percentageBonus
      }))
    ).onConflictDoNothing()
  }

  const [settings] = await db.select().from(globalSettings).where(eq(globalSettings.userId, userId)).limit(1)
  const milestones = await db.select().from(milestoneDefinitions).where(eq(milestoneDefinitions.userId, userId))

  return {
    settings: settings ?? null,
    milestones
  }
}
