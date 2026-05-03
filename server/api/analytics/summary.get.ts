import { analyticsService } from '../../services/analytics/analyticsService'
import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const summary = await analyticsService.getSummary(user.id)

  return success(summary)
})
