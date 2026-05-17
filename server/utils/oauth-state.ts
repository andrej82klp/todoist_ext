import { randomBytes, timingSafeEqual } from 'node:crypto'

import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'

const TODOIST_OAUTH_STATE_COOKIE = 'todoist_oauth_state'
const OAUTH_STATE_TTL_SECONDS = 60 * 10

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  }
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function issueTodoistOauthState(event: H3Event) {
  const state = randomBytes(24).toString('base64url')

  setCookie(event, TODOIST_OAUTH_STATE_COOKIE, state, {
    ...getCookieOptions(),
    maxAge: OAUTH_STATE_TTL_SECONDS
  })

  return state
}

export function consumeTodoistOauthState(event: H3Event, expectedState: string) {
  const actualState = getCookie(event, TODOIST_OAUTH_STATE_COOKIE)

  deleteCookie(event, TODOIST_OAUTH_STATE_COOKIE, getCookieOptions())

  if (!actualState || !expectedState) {
    return false
  }

  return safeCompare(actualState, expectedState)
}
