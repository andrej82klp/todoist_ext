import type { GlobalSettings, NewGlobalSettings } from '../../db/schema'
import { settingsRepository } from '../../repositories/settings'
import type { SettingsPatchBody } from '../../../shared/schemas/settings'
import type { GlobalSettingsResponse, SettingsMilestoneDefinition } from '../../../shared/types'
import { internalServerError } from '../../utils/api'

type GlobalSettingsInsert = NewGlobalSettings

function numericToNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

function mapMilestoneRow(row: {
  days: number
  fixedBonusPoints: number
  percentageBonus: string
  isActive: boolean
}): SettingsMilestoneDefinition {
  return {
    days: row.days,
    fixedBonusPoints: row.fixedBonusPoints,
    percentageBonus: numericToNumber(row.percentageBonus),
    isActive: row.isActive
  }
}

function mapSettingsRowToResponse(
  row: GlobalSettings,
  milestoneRows: Awaited<ReturnType<typeof settingsRepository.findMilestonesByUserId>>
): GlobalSettingsResponse {
  const completionPercent = numericToNumber(row.completionBonusPercent)
  const sortedMilestones = [...milestoneRows]
    .sort((a, b) => a.days - b.days)
    .map(mapMilestoneRow)

  return {
    points: {
      difficultyMultiplierBase: row.difficultyMultiplierBase,
      priorityMultipliers: {
        low: numericToNumber(row.lowPriorityMultiplier),
        medium: numericToNumber(row.mediumPriorityMultiplier),
        high: numericToNumber(row.highPriorityMultiplier)
      },
      defaultCompletionBonusEnabled: completionPercent > 0,
      defaultCompletionBonusPercent: completionPercent
    },
    streak: {
      ruleType: row.streakRuleType,
      ruleValue: row.streakRuleValue,
      protectionEnabled: row.streakProtectionEnabled,
      startingProtectionBalance: row.streakProtectionStartingBalance,
      protectionRewardEveryNDays: row.protectionRewardEveryNDays,
      protectionRewardAmount: row.protectionRewardAmount,
      bonusStrategy: row.milestoneBonusStrategy,
      milestonePercentageWindowDays: row.milestonePercentageWindowDays,
      milestones: sortedMilestones
    }
  }
}

async function loadSettingsResponse(userId: string): Promise<GlobalSettingsResponse> {
  await settingsRepository.ensureDefaults(userId)
  const row = await settingsRepository.findByUserId(userId)

  if (!row) {
    throw internalServerError('Global settings row missing after ensureDefaults')
  }

  const milestones = await settingsRepository.findMilestonesByUserId(userId)
  return mapSettingsRowToResponse(row, milestones)
}

export const settingsService = {
  async getSettings(userId: string): Promise<GlobalSettingsResponse> {
    return loadSettingsResponse(userId)
  },

  async updateSettings(userId: string, body: SettingsPatchBody): Promise<GlobalSettingsResponse> {
    const flat: Partial<GlobalSettingsInsert> = {}

    if (body.points) {
      const p = body.points
      if (p.difficultyMultiplierBase !== undefined) {
        flat.difficultyMultiplierBase = p.difficultyMultiplierBase
      }
      if (p.priorityMultipliers) {
        const pm = p.priorityMultipliers
        if (pm.low !== undefined) flat.lowPriorityMultiplier = String(pm.low)
        if (pm.medium !== undefined) flat.mediumPriorityMultiplier = String(pm.medium)
        if (pm.high !== undefined) flat.highPriorityMultiplier = String(pm.high)
      }
      if (p.defaultCompletionBonusEnabled === false) {
        flat.completionBonusPercent = '0.00'
      }
      if (p.defaultCompletionBonusPercent !== undefined && p.defaultCompletionBonusEnabled !== false) {
        flat.completionBonusPercent = String(p.defaultCompletionBonusPercent)
      }
    }

    if (body.streak) {
      const s = body.streak
      if (s.ruleType !== undefined) flat.streakRuleType = s.ruleType
      if (s.ruleValue !== undefined) flat.streakRuleValue = s.ruleValue
      if (s.protectionEnabled !== undefined) flat.streakProtectionEnabled = s.protectionEnabled
      if (s.startingProtectionBalance !== undefined) {
        flat.streakProtectionStartingBalance = s.startingProtectionBalance
      }
      if (s.protectionRewardEveryNDays !== undefined) {
        flat.protectionRewardEveryNDays = s.protectionRewardEveryNDays
      }
      if (s.protectionRewardAmount !== undefined) flat.protectionRewardAmount = s.protectionRewardAmount
      if (s.bonusStrategy !== undefined) flat.milestoneBonusStrategy = s.bonusStrategy
      if (s.milestonePercentageWindowDays !== undefined) {
        flat.milestonePercentageWindowDays = s.milestonePercentageWindowDays
      }
    }

    if (Object.keys(flat).length > 0) {
      await settingsRepository.updateGlobalSettings(userId, flat)
    }

    if (body.streak?.milestones !== undefined) {
      await settingsRepository.replaceMilestones(
        userId,
        body.streak.milestones.map(m => ({
          days: m.days,
          fixedBonusPoints: m.fixedBonusPoints,
          percentageBonus: Number(m.percentageBonus).toFixed(2),
          isActive: m.isActive
        }))
      )
    }

    return loadSettingsResponse(userId)
  }
}
