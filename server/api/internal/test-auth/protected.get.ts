import { defineApiHandler, success } from '../../../utils/api'
import { requireCurrentUser, toSessionUser } from '../../../utils/session'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)

  return success({
    user: toSessionUser(user)
  })
})
