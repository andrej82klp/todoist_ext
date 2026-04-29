import 'dotenv/config'

import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { pointBalances, users } from '../../server/db/schema'
import { ledgerRepository } from '../../server/repositories/ledger'
import { rewardsRepository } from '../../server/repositories/rewards'
import { settingsRepository } from '../../server/repositories/settings'
import { usersRepository } from '../../server/repositories/users'

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

describe('Milestone 2 repository smoke tests', () => {
  afterAll(async () => {
    await closeDbConnection()
  })

  runIfDatabaseConfigured('inserts and reads users, defaults, rewards, and ledger rows', async () => {
    const db = getDb()
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const todoistUserId = `smoke-${testSuffix}`
    const email = `smoke-${testSuffix}@example.com`

    const user = await usersRepository.create({
      email,
      todoistUserId,
      displayName: 'Smoke Test User',
      timezone: 'UTC'
    })

    const defaults = await ensureUserDefaults(user.id)
    const reward = await rewardsRepository.create({
      userId: user.id,
      name: 'Smoke Test Reward',
      costPoints: 125,
      description: 'Verifies inserts and reads'
    })
    const transaction = await ledgerRepository.createTransaction({
      userId: user.id,
      transactionType: 'earned',
      amount: 125,
      description: 'Smoke test ledger transaction',
      source: 'smoke_test',
      relatedEntityType: 'test',
      relatedEntityId: testSuffix,
      idempotencyKey: `smoke-${testSuffix}`,
      metadata: { scope: 'milestone-2' }
    })

    const storedUser = await usersRepository.findByTodoistUserId(todoistUserId)
    const storedSettings = await settingsRepository.findByUserId(user.id)
    const storedMilestones = await settingsRepository.findMilestonesByUserId(user.id)
    const storedBalance = await settingsRepository.findPointBalanceByUserId(user.id)
    const storedRewards = await rewardsRepository.listByUserId(user.id)
    const storedTransactions = await ledgerRepository.listByUserId(user.id)

    expect(storedUser?.email).toBe(email)
    expect(storedSettings?.difficultyMultiplierBase).toBe(10)
    expect(storedMilestones.map(milestone => milestone.days)).toEqual([7, 14, 30])
    expect(storedBalance?.currentBalance).toBe(0)
    expect(reward.id).toBeTruthy()
    expect(storedRewards[0]?.name).toBe('Smoke Test Reward')
    expect(transaction.amount).toBe(125)
    expect(storedTransactions[0]?.source).toBe('smoke_test')
    expect(Number(defaults.settings?.mediumPriorityMultiplier ?? 0)).toBe(1.25)

    await db.delete(pointBalances).where(eq(pointBalances.userId, user.id))
    await db.delete(users).where(eq(users.id, user.id))
  })
})
