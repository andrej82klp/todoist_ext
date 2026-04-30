import { getRouterParam, sendNoContent } from 'h3'

import { rewardsService } from '../../../services/rewards/rewardsService'
import { badRequestError, defineApiHandler } from '../../../utils/api'
import { requireCurrentUser } from '../../../utils/session'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const rewardId = getRouterParam(event, 'rewardId')

  if (!rewardId) {
    throw badRequestError('Missing reward id')
  }

  await rewardsService.deleteOrArchiveReward(user.id, rewardId)

  return sendNoContent(event)
})
