import { getHeader, getRouterParam } from 'h3'

import { rewardsService } from '../../../services/rewards/rewardsService'
import { badRequestError, defineApiHandler, success, tooManyRequestsError } from '../../../utils/api'
import { checkRateLimit, createRateLimiter } from '../../../utils/rate-limit'
import { requireCurrentUser } from '../../../utils/session'

// 20 redemption attempts per user per minute.
const redeemLimiter = createRateLimiter({ windowMs: 60_000, max: 20 })

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)

  if (!checkRateLimit(redeemLimiter, event, 'per-user', user.id)) {
    throw tooManyRequestsError()
  }

  const rewardId = getRouterParam(event, 'rewardId')

  if (!rewardId) {
    throw badRequestError('Missing reward id')
  }

  const idempotencyKey = getHeader(event, 'Idempotency-Key')?.trim() || null
  const result = await rewardsService.redeemReward(user.id, rewardId, { idempotencyKey })

  return success(result)
})
