import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'
import { settingsService } from '../../services/settings/settingsService'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const settings = await settingsService.getSettings(user.id)
  return success(settings)
})
