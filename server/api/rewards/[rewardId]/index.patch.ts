import { getRouterParam } from 'h3'

import { rewardUpdateSchema } from '../../../../shared/schemas'
import { rewardsService } from '../../../services/rewards/rewardsService'
import { badRequestError, defineApiHandler, success } from '../../../utils/api'
import { requireCurrentUser } from '../../../utils/session'
import { parseBodyWithSchema } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const rewardId = getRouterParam(event, 'rewardId')

  if (!rewardId) {
    throw badRequestError('Missing reward id')
  }

  const body = await parseBodyWithSchema(event, rewardUpdateSchema)
  const reward = await rewardsService.updateReward(user.id, rewardId, body)

  return success(reward)
})
