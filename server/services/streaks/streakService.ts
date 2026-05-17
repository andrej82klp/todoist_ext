import type { DatabaseClient } from '../../db/client'
import { getDb } from '../../db/client'
import { ledgerRepository } from '../../repositories/ledger'
import { settingsRepository } from '../../repositories/settings'
import { streaksRepository } from '../../repositories/streaks'

export interface StreakMilestoneAward {
  milestoneDays: number
  bonusPoints: number
  ledgerTransactionId: string | null
}

export interface StreakEvaluationResult {
  activityDate: string
  qualified: boolean
  qualifiedBy: 'completed_items' | 'points' | null
  currentStreak: number
  longestStreak: number
  protectionConsumed: boolean
  protectionBalance: number
  milestoneAwards: StreakMilestoneAward[]
}

// ── Date utilities ────────────────────────────────────────────────────────────

export function addDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(year!, month! - 1, day!))
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Core evaluation logic (shared by public and webhook-internal paths) ───────

async function runEvaluateDayInTransaction(
  tx: DatabaseClient,
  userId: string,
  date: string
): Promise<StreakEvaluationResult> {
  // Idempotency guard inside the transaction
  const state = await streaksRepository.findStateByUserIdInTransaction(tx, userId)
  if (state?.lastEvaluatedDate && state.lastEvaluatedDate >= date) {
    const protection = await streaksRepository.findProtectionByUserIdInTransaction(tx, userId)
    return {
      activityDate: date,
      qualified: false,
      qualifiedBy: null,
      currentStreak: state.currentStreak,
      longestStreak: state.longestStreak,
      protectionConsumed: false,
      protectionBalance: protection?.balance ?? 0,
      milestoneAwards: []
    }
  }

  const [settings, protection, historyRow, milestones] = await Promise.all([
    settingsRepository.findByUserIdInTransaction(tx, userId),
    streaksRepository.findProtectionByUserIdInTransaction(tx, userId),
    streaksRepository.findHistoryByUserIdAndDateInTransaction(tx, userId, date),
    streaksRepository.findMilestonesByUserIdInTransaction(tx, userId)
  ])

  const pointsEarned = historyRow?.pointsEarned ?? 0
  const completedCount = historyRow?.completedCount ?? 0

  // ── Qualification ─────────────────────────────────────────────────────────
  const ruleType = settings?.streakRuleType ?? 'completed_items'
  const ruleValue = settings?.streakRuleValue ?? 1

  const qualified = ruleType === 'completed_items'
    ? completedCount >= ruleValue
    : pointsEarned >= ruleValue

  const qualifiedBy: 'completed_items' | 'points' | null = qualified ? ruleType : null

  // ── Streak arithmetic ─────────────────────────────────────────────────────
  const prevStreak = state?.currentStreak ?? 0
  const prevLongest = state?.longestStreak ?? 0
  const prevLastEvaluatedDate = state?.lastEvaluatedDate ?? null
  const prevLastQualifiedDate = state?.lastQualifiedDate ?? null

  const protectionEnabled = settings?.streakProtectionEnabled ?? true
  const protectionBalance = protection?.balance ?? 0

  let newStreak: number
  let protectionConsumed = false

  if (qualified) {
    // A qualified day increments the streak when it immediately follows the
    // last evaluated date. If there is a gap (missed days evaluated earlier),
    // the streak was already reset by those evaluations, so we still increment
    // from whatever the current streak is.
    const isFirstEver = prevLastEvaluatedDate === null
    const isConsecutive = prevLastEvaluatedDate !== null && addDay(prevLastEvaluatedDate) === date

    if (isFirstEver) {
      newStreak = 1
    } else if (isConsecutive) {
      newStreak = prevStreak + 1
    } else {
      // There's a gap — missed days should have been processed by catch-up
      // first. This can happen if catch-up was skipped. Treat as first-of-run.
      newStreak = prevStreak > 0 ? prevStreak + 1 : 1
    }
  } else {
    // Missed day
    if (protectionEnabled && protectionBalance > 0 && prevStreak > 0) {
      protectionConsumed = true
      newStreak = prevStreak // preserve
    } else {
      newStreak = 0 // break
    }
  }

  const newLongest = Math.max(prevLongest, newStreak)
  let newProtectionBalance = protectionBalance

  // ── Apply protection consumption ──────────────────────────────────────────
  if (protectionConsumed) {
    newProtectionBalance = protectionBalance - 1
    await streaksRepository.updateProtectionInTransaction(tx, userId, { balance: newProtectionBalance })

    // Deduplicate: one notification per protected date
    const existing = await streaksRepository.findProtectionNotificationByUserIdAndProtectedDateInTransaction(
      tx,
      userId,
      date
    )
    if (!existing) {
      await streaksRepository.createProtectionNotificationInTransaction(tx, {
        userId,
        protectedDate: date,
        remainingBalance: newProtectionBalance
      })
    }
  }

  // ── Apply protection reward (every N qualifying days) ─────────────────────
  const protectionRewardEveryNDays = settings?.protectionRewardEveryNDays ?? 10
  const protectionRewardAmount = settings?.protectionRewardAmount ?? 1

  if (qualified && newStreak > 0 && newStreak % protectionRewardEveryNDays === 0 && protectionRewardAmount > 0) {
    const prevTier = Math.floor(prevStreak / protectionRewardEveryNDays)
    const newTier = Math.floor(newStreak / protectionRewardEveryNDays)
    if (newTier > prevTier) {
      newProtectionBalance = newProtectionBalance + protectionRewardAmount
      await streaksRepository.updateProtectionInTransaction(tx, userId, {
        balance: newProtectionBalance,
        lastRewardedAt: new Date()
      })
    }
  }

  // ── Persist history evaluation result ─────────────────────────────────────
  await streaksRepository.upsertHistoryEvaluationResultInTransaction(tx, userId, date, {
    qualified,
    qualifiedBy,
    streakLength: newStreak,
    protectionConsumed,
    pointsEarned,
    completedCount
  })

  // ── Persist streak state ───────────────────────────────────────────────────
  await streaksRepository.updateStateInTransaction(tx, userId, {
    currentStreak: newStreak,
    longestStreak: newLongest,
    lastEvaluatedDate: date,
    lastQualifiedDate: qualified ? date : prevLastQualifiedDate,
    lastProtectionUsedDate: protectionConsumed ? date : (state?.lastProtectionUsedDate ?? null)
  })

  // ── Milestone awards (only on advancing qualifying days) ──────────────────
  const awardResults: StreakMilestoneAward[] = []

  if (qualified && newStreak > prevStreak) {
    const activeMilestones = milestones.filter(m => m.isActive && m.days === newStreak)
    const bonusStrategy = settings?.milestoneBonusStrategy ?? 'fixed'
    const windowDays = settings?.milestonePercentageWindowDays ?? 5

    for (const milestone of activeMilestones) {
      // Skip if already awarded (unique index also guards this)
      const existingAward = await streaksRepository.findAwardByUserIdAndMilestoneIdInTransaction(
        tx,
        userId,
        milestone.id
      )
      if (existingAward) {
        continue
      }

      let bonusPoints = 0

      if (bonusStrategy === 'fixed') {
        bonusPoints = milestone.fixedBonusPoints
      } else {
        // Percentage bonus: sum base earned points from recent qualified days
        const qualifiedHistory = await streaksRepository.listRecentQualifiedHistoryInTransaction(
          tx,
          userId,
          date,
          windowDays
        )
        const baseTotal = qualifiedHistory.reduce((sum, h) => sum + h.pointsEarned, 0)
        bonusPoints = Math.round(baseTotal * (Number(milestone.percentageBonus) / 100))
      }

      let ledgerTransactionId: string | null = null

      if (bonusPoints > 0) {
        const result = await ledgerRepository.createTransactionAndUpdateBalanceInTransactionIdempotent(tx, {
          userId,
          transactionType: 'bonus',
          amount: bonusPoints,
          description: `Streak milestone bonus: ${milestone.days}-day streak`,
          source: 'streak_milestone',
          relatedEntityType: 'milestone_definition',
          relatedEntityId: milestone.id,
          idempotencyKey: `streak_milestone:${userId}:${milestone.id}`
        })
        ledgerTransactionId = result.transaction.id
      }

      await streaksRepository.createMilestoneAwardInTransaction(tx, {
        userId,
        milestoneDefinitionId: milestone.id,
        awardedForDays: newStreak,
        ledgerTransactionId
      })

      awardResults.push({
        milestoneDays: milestone.days,
        bonusPoints,
        ledgerTransactionId
      })
    }
  }

  return {
    activityDate: date,
    qualified,
    qualifiedBy,
    currentStreak: newStreak,
    longestStreak: newLongest,
    protectionConsumed,
    protectionBalance: newProtectionBalance,
    milestoneAwards: awardResults
  }
}

// ── Public service ────────────────────────────────────────────────────────────

export const streakService = {
  /**
   * Evaluate a single calendar day for streak progression. Safe to call
   * multiple times — if the day was already evaluated (lastEvaluatedDate >=
   * date), returns immediately without side effects.
   */
  async evaluateDay(userId: string, date: string): Promise<StreakEvaluationResult> {
    await settingsRepository.ensureDefaults(userId)

    // Fast idempotency check without starting a transaction
    const state = await streaksRepository.findStateByUserId(userId)
    if (state?.lastEvaluatedDate && state.lastEvaluatedDate >= date) {
      const protection = await streaksRepository.findProtectionByUserId(userId)
      return {
        activityDate: date,
        qualified: false,
        qualifiedBy: null,
        currentStreak: state.currentStreak,
        longestStreak: state.longestStreak,
        protectionConsumed: false,
        protectionBalance: protection?.balance ?? 0,
        milestoneAwards: []
      }
    }

    const db = getDb()
    return db.transaction(async (tx) => {
      return runEvaluateDayInTransaction(tx as unknown as DatabaseClient, userId, date)
    })
  },

  /**
   * Evaluate a day within an existing database transaction.  Used by the
   * Todoist webhook handler so that point awards and streak changes are atomic.
   */
  async evaluateDayInTransaction(tx: DatabaseClient, userId: string, date: string): Promise<StreakEvaluationResult> {
    return runEvaluateDayInTransaction(tx, userId, date)
  },

  /**
   * Walk forward from the last evaluated date through `targetDate` and
   * evaluate any unevaluated days as missed days.  Called on dashboard reads
   * so that stale streak state resolves before the user sees the summary.
   *
   * Stops at `targetDate` (exclusive of today) so the current day is not
   * penalised while the user still has time to qualify.
   */
  async ensureEvaluatedThroughDate(userId: string, targetDate: string): Promise<void> {
    await settingsRepository.ensureDefaults(userId)

    const state = await streaksRepository.findStateByUserId(userId)

    // Nothing to catch up if the user has never had a qualifying activity
    if (!state?.lastEvaluatedDate) {
      return
    }

    let current = addDay(state.lastEvaluatedDate)

    while (current <= targetDate) {
      // evaluateDay handles its own idempotency and transaction
      await streakService.evaluateDay(userId, current)
      // Re-read state in case another process updated it
      const refreshed = await streaksRepository.findStateByUserId(userId)
      if (refreshed?.lastEvaluatedDate && refreshed.lastEvaluatedDate >= targetDate) {
        break
      }
      current = addDay(current)
    }
  },

  /**
   * Convenience accessor used in tests and manual verification.
   */
  yesterdayUtc
}

// Export date helpers for use in other modules
export { todayUtc, yesterdayUtc }
