import type { z } from 'zod'

import type { rewardCreateSchema, rewardUpdateSchema } from '../../../shared/schemas/rewards'
import type { RedemptionRecord, Reward } from '../../../shared/types'
import { ledgerRepository } from '../../repositories/ledger'
import type { RewardRedemptionListRow } from '../../repositories/rewards'
import { rewardsRepository } from '../../repositories/rewards'
import { notFoundError, internalServerError } from '../../utils/api'
import { pointsEngineService } from '../points/pointsEngineService'

type RewardCreateBody = z.infer<typeof rewardCreateSchema>
type RewardUpdateBody = z.infer<typeof rewardUpdateSchema>

function getCurrentBalance(userId: string) {
  return ledgerRepository.getBalanceByUserId(userId).then(row => row?.currentBalance ?? 0)
}

export function toRewardDomain(
  row: {
    id: string
    name: string
    description: string | null
    category: string | null
    costPoints: number
    isArchived: boolean
    createdAt: Date
    updatedAt: Date
  },
  currentBalance: number
): Reward {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    costPoints: row.costPoints,
    isArchived: row.isArchived,
    affordability: {
      canRedeem: !row.isArchived && currentBalance >= row.costPoints,
      missingPoints: Math.max(0, row.costPoints - currentBalance)
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export function toRedemptionDomain(row: RewardRedemptionListRow): RedemptionRecord {
  return {
    id: row.id,
    rewardId: row.rewardId,
    rewardName: row.rewardName,
    costPoints: row.costPoints,
    redeemedAt: row.redeemedAt.toISOString()
  }
}

export const rewardsService = {
  async listForUser(
    userId: string,
    options: { includeArchived: boolean, page: number, pageSize: number }
  ) {
    const [rows, total, balanceRow] = await Promise.all([
      rewardsRepository.listByUserIdPaginated(
        userId,
        options.includeArchived,
        options.page,
        options.pageSize
      ),
      rewardsRepository.countByUserId(userId, options.includeArchived),
      ledgerRepository.getBalanceByUserId(userId)
    ])

    const currentBalance = balanceRow?.currentBalance ?? 0
    const rewards = rows.map(row => toRewardDomain(row, currentBalance))
    const pointsSummary = pointsEngineService.balanceRowToSummary(balanceRow)

    return {
      rewards,
      pointsSummary,
      meta: {
        page: options.page,
        pageSize: options.pageSize,
        total
      }
    }
  },

  async createReward(userId: string, input: RewardCreateBody): Promise<Reward> {
    const row = await rewardsRepository.create({
      userId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      costPoints: input.costPoints
    })

    if (!row) {
      throw internalServerError('Failed to create reward')
    }

    const currentBalance = await getCurrentBalance(userId)
    return toRewardDomain(row, currentBalance)
  },

  async updateReward(userId: string, rewardId: string, input: RewardUpdateBody): Promise<Reward> {
    const existing = await rewardsRepository.findById(rewardId)

    if (!existing || existing.userId !== userId) {
      throw notFoundError('Reward not found')
    }

    const updatePayload: Parameters<typeof rewardsRepository.updateById>[1] = {}

    if (input.name !== undefined) updatePayload.name = input.name
    if (input.description !== undefined) updatePayload.description = input.description
    if (input.category !== undefined) updatePayload.category = input.category
    if (input.costPoints !== undefined) updatePayload.costPoints = input.costPoints

    if (input.isArchived !== undefined) {
      updatePayload.isArchived = input.isArchived
      if (input.isArchived === true && !existing.isArchived) {
        updatePayload.archivedAt = new Date()
      }
      if (input.isArchived === false) {
        updatePayload.archivedAt = null
      }
    }

    const updated = await rewardsRepository.updateById(rewardId, updatePayload)

    if (!updated) {
      throw notFoundError('Reward not found')
    }

    const currentBalance = await getCurrentBalance(userId)
    return toRewardDomain(updated, currentBalance)
  },

  async deleteOrArchiveReward(userId: string, rewardId: string) {
    const existing = await rewardsRepository.findById(rewardId)

    if (!existing || existing.userId !== userId) {
      throw notFoundError('Reward not found')
    }

    const hasHistory = await rewardsRepository.hasRedemptionHistory(rewardId)

    if (hasHistory) {
      await rewardsRepository.archiveById(rewardId)
    } else {
      await rewardsRepository.deleteById(rewardId)
    }
  },

  async listRedemptions(userId: string, options: { page: number, pageSize: number }) {
    const [rows, total] = await Promise.all([
      rewardsRepository.listRedemptionsByUserId(userId, options.page, options.pageSize),
      rewardsRepository.countRedemptionsByUserId(userId)
    ])

    return {
      redemptions: rows.map(toRedemptionDomain),
      meta: {
        page: options.page,
        pageSize: options.pageSize,
        total
      }
    }
  }
}
