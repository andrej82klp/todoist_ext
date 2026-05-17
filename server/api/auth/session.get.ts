import { defineApiHandler, success } from '../../utils/api'
import { buildAuthSessionState } from '../../utils/session'

export default defineApiHandler(async (event) => {
  return success(await buildAuthSessionState(event))
})
