import { desc, eq } from 'drizzle-orm'

import { getDb } from '../db/client'
import { rewards } from '../db/schema'

export interface CreateRewardInput {
  userId: string
  name: string
  description?: string | null
  category?: string | null
  costPoints: number
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
  }
}
