import { dashboardService } from '../../services/dashboard/dashboardService'
import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const dashboard = await dashboardService.getDashboard(user.id)

  return success(dashboard)
})
