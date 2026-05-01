import { and, count, desc, eq } from 'drizzle-orm'

import type { DatabaseClient } from '../db/client'
import { getDb } from '../db/client'
import { rewardRedemptions, rewards } from '../db/schema'

export interface CreateRewardInput {
  userId: string
  name: string
  description?: string | null
  category?: string | null
  costPoints: number
}

export interface UpdateRewardData {
  name?: string
  description?: string | null
  category?: string | null
  costPoints?: number
  isArchived?: boolean
  archivedAt?: Date | null
}

export interface RewardRedemptionListRow {
  id: string
  userId: string
  rewardId: string
  rewardName: string
  costPoints: number
  redeemedAt: Date
}

export interface RewardRedemptionRow extends RewardRedemptionListRow {
  idempotencyKey: string | null
}

export interface CreateRewardRedemptionInput {
  userId: string
  rewardId: string
  costPoints: number
  redemptionNote?: string | null
  idempotencyKey?: string | null
}

function redemptionDetailsSelect(db: DatabaseClient) {
  return db.select({
    id: rewardRedemptions.id,
    userId: rewardRedemptions.userId,
    rewardId: rewardRedemptions.rewardId,
    rewardName: rewards.name,
    costPoints: rewardRedemptions.costPoints,
    redeemedAt: rewardRedemptions.redeemedAt,
    idempotencyKey: rewardRedemptions.idempotencyKey
  }).from(rewardRedemptions)
    .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
}

export const rewardsRepository = {
  async create(input: CreateRewardInput) {
    const db = getDb()
    const [reward] = await db.insert(rewards).values({
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      costPoints: input.costPoints
    }).returning()

    return reward
  },

  async findById(id: string) {
    const db = getDb()
    const [reward] = await db.select().from(rewards).where(eq(rewards.id, id)).limit(1)

    return reward ?? null
  },

  async listByUserId(userId: string) {
    const db = getDb()

    return db.select().from(rewards).where(eq(rewards.userId, userId)).orderBy(desc(rewards.createdAt))
  },

  async updateById(id: string, data: UpdateRewardData) {
    const db = getDb()
    const setValues: Partial<typeof rewards.$inferInsert> = {
      updatedAt: new Date()
    }

    if (data.name !== undefined) setValues.name = data.name
    if (data.description !== undefined) setValues.description = data.description
    if (data.category !== undefined) setValues.category = data.category
    if (data.costPoints !== undefined) setValues.costPoints = data.costPoints
    if (data.isArchived !== undefined) setValues.isArchived = data.isArchived
    if (data.archivedAt !== undefined) setValues.archivedAt = data.archivedAt

    const [reward] = await db.update(rewards).set(setValues).where(eq(rewards.id, id)).returning()

    return reward ?? null
  },

  async archiveById(id: string) {
    return rewardsRepository.updateById(id, {
      isArchived: true,
      archivedAt: new Date()
    })
  },

  async deleteById(id: string) {
    const db = getDb()
    await db.delete(rewards).where(eq(rewards.id, id))
  },

  async hasRedemptionHistory(rewardId: string) {
    const db = getDb()
    const [row] = await db.select({ c: count() }).from(rewardRedemptions).where(eq(rewardRedemptions.rewardId, rewardId))

    return (row?.c ?? 0) > 0
  },

  async listByUserIdPaginated(userId: string, includeArchived: boolean, page: number, pageSize: number) {
    const db = getDb()
    const offset = (page - 1) * pageSize

    const whereClause = includeArchived
      ? eq(rewards.userId, userId)
      : and(eq(rewards.userId, userId), eq(rewards.isArchived, false))

    return db.select().from(rewards)
      .where(whereClause)
      .orderBy(desc(rewards.createdAt))
      .limit(pageSize)
      .offset(offset)
  },

  async countByUserId(userId: string, includeArchived: boolean) {
    const db = getDb()

    const whereClause = includeArchived
      ? eq(rewards.userId, userId)
      : and(eq(rewards.userId, userId), eq(rewards.isArchived, false))

    const [row] = await db.select({ c: count() }).from(rewards).where(whereClause)

    return row?.c ?? 0
  },

  async createRedemption(tx: DatabaseClient, input: CreateRewardRedemptionInput) {
    const [redemption] = await tx.insert(rewardRedemptions).values({
      userId: input.userId,
      rewardId: input.rewardId,
      costPoints: input.costPoints,
      redemptionNote: input.redemptionNote ?? null,
      idempotencyKey: input.idempotencyKey ?? null
    }).onConflictDoNothing().returning()

    return redemption ?? null
  },

  async findRedemptionById(id: string): Promise<RewardRedemptionRow | null> {
    const db = getDb()
    const [row] = await redemptionDetailsSelect(db)
      .where(eq(rewardRedemptions.id, id))
      .limit(1)

    return row ?? null
  },

  async findRedemptionByUserIdAndIdempotencyKey(userId: string, idempotencyKey: string | null | undefined): Promise<RewardRedemptionRow | null> {
    if (!idempotencyKey) {
      return null
    }

    const db = getDb()
    const [row] = await redemptionDetailsSelect(db)
      .where(and(
        eq(rewardRedemptions.userId, userId),
        eq(rewardRedemptions.idempotencyKey, idempotencyKey)
      ))
      .limit(1)

    return row ?? null
  },

  async listRedemptionsByUserId(userId: string, page: number, pageSize: number): Promise<RewardRedemptionListRow[]> {
    const db = getDb()
    const offset = (page - 1) * pageSize

    const rows = await db.select({
      id: rewardRedemptions.id,
      userId: rewardRedemptions.userId,
      rewardId: rewardRedemptions.rewardId,
      rewardName: rewards.name,
      costPoints: rewardRedemptions.costPoints,
      redeemedAt: rewardRedemptions.redeemedAt
    }).from(rewardRedemptions)
      .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
      .where(eq(rewardRedemptions.userId, userId))
      .orderBy(desc(rewardRedemptions.redeemedAt))
      .limit(pageSize)
      .offset(offset)

    return rows
  },

  async countRedemptionsByUserId(userId: string) {
    const db = getDb()
    const [row] = await db.select({ c: count() }).from(rewardRedemptions).where(eq(rewardRedemptions.userId, userId))

    return row?.c ?? 0
  }
}
