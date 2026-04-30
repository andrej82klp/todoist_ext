import { settingsPatchBodySchema } from '../../../shared/schemas'
import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'
import { parseBodyWithSchema } from '../../utils/validation'
import { settingsService } from '../../services/settings/settingsService'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const body = await parseBodyWithSchema(event, settingsPatchBodySchema)
  const settings = await settingsService.updateSettings(user.id, body)
  return success({ success: true, settings })
})
