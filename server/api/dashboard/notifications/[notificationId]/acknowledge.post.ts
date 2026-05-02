import { getRouterParam } from 'h3'

import { dashboardService } from '../../../../services/dashboard/dashboardService'
import { badRequestError, defineApiHandler, success } from '../../../../utils/api'
import { requireCurrentUser } from '../../../../utils/session'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const notificationId = getRouterParam(event, 'notificationId')

  if (!notificationId) {
    throw badRequestError('Notification id is required')
  }

  const result = await dashboardService.acknowledgeNotification(user.id, notificationId)
  return success(result)
})
