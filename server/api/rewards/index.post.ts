import { setResponseStatus } from 'h3'

import { rewardCreateSchema } from '../../../shared/schemas'
import { rewardsService } from '../../services/rewards/rewardsService'
import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'
import { parseBodyWithSchema } from '../../utils/validation'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const body = await parseBodyWithSchema(event, rewardCreateSchema)

  const reward = await rewardsService.createReward(user.id, body)
  setResponseStatus(event, 201)

  return success(reward)
})
