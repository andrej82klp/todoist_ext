import type { AnalyticsSummary } from '../../../shared/types'
import { analyticsRepository } from '../../repositories/analytics'
import { settingsRepository } from '../../repositories/settings'
import { streaksRepository } from '../../repositories/streaks'

export const analyticsService = {
  async getSummary(userId: string): Promise<AnalyticsSummary> {
    await settingsRepository.ensureDefaults(userId)

    const [projectRows, streakState, reachedMilestoneDays] = await Promise.all([
      analyticsRepository.listMostRewardingProjectsByUserId(userId, 5),
      streaksRepository.findStateByUserId(userId),
      analyticsRepository.listReachedMilestonesByUserId(userId)
    ])

    // Defensive dedup and sort in case of unexpected duplicates from the DB.
    const milestonesReached = [...new Set(reachedMilestoneDays)].sort((a, b) => a - b)

    return {
      mostRewardingProjects: projectRows,
      streakHistory: {
        current: streakState?.currentStreak ?? 0,
        longest: streakState?.longestStreak ?? 0,
        milestonesReached
      }
    }
  }
}
