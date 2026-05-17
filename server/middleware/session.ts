import { defineEventHandler } from 'h3'

import { getAppSession } from '../utils/session'

export default defineEventHandler((event) => {
  getAppSession(event)
})
