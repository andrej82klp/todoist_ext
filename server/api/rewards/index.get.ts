import { rewardsListQuerySchema } from '../../../shared/schemas'
import { rewardsService } from '../../services/rewards/rewardsService'
import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'
import { parseQueryWithSchema } from '../../utils/validation'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const query = parseQueryWithSchema(event, rewardsListQuerySchema)

  const result = await rewardsService.listForUser(user.id, {
    includeArchived: query.includeArchived,
    page: query.page,
    pageSize: query.pageSize
  })

  return success(result)
})
