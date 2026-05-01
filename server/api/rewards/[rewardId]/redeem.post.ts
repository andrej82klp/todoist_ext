import { getHeader, getRouterParam } from 'h3'

import { rewardsService } from '../../../services/rewards/rewardsService'
import { badRequestError, defineApiHandler, success } from '../../../utils/api'
import { requireCurrentUser } from '../../../utils/session'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const rewardId = getRouterParam(event, 'rewardId')

  if (!rewardId) {
    throw badRequestError('Missing reward id')
  }

  const idempotencyKey = getHeader(event, 'Idempotency-Key')?.trim() || null
  const result = await rewardsService.redeemReward(user.id, rewardId, { idempotencyKey })

  return success(result)
})
