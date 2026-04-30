import { defineApiHandler, action } from '../../utils/api'
import { clearAppSession } from '../../utils/session'

export default defineApiHandler((event) => {
  clearAppSession(event)

  return action(true, 'Session cleared')
})
