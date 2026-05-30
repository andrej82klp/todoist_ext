import { z } from 'zod'

import { API_ERROR_MESSAGE } from '../../../shared/constants/api'
import { badRequestError, internalServerError } from '../../utils/api'
import { logger } from '../../utils/logger'

const TODOIST_AUTHORIZE_URL = 'https://app.todoist.com/oauth/authorize'
const TODOIST_TOKEN_URL = 'https://api.todoist.com/oauth/access_token'
const TODOIST_USER_URL = 'https://api.todoist.com/api/v1/user'
const TODOIST_LEGACY_USER_URL = 'https://api.todoist.com/sync/v9/user'

const todoistTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive().optional()
}).strict()

const todoistUserSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(value => String(value)),
  email: z.string().email().optional(),
  full_name: z.string().optional(),
  avatar_big: z.string().url().optional(),
  tz_info: z.object({
    timezone: z.string().optional()
  }).optional()
}).passthrough()

function getEnvValue(name: string) {
  const value = process.env[name]

  if (!value || value.length === 0) {
    throw internalServerError(`${name} is not configured`)
  }

  return value
}

function getRedirectUri() {
  return getEnvValue('TODOIST_REDIRECT_URI')
}

export function buildTodoistAuthorizeUrl(state: string) {
  const url = new URL(TODOIST_AUTHORIZE_URL)

  url.searchParams.set('client_id', getEnvValue('TODOIST_CLIENT_ID'))
  url.searchParams.set('scope', 'data:read')
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', getRedirectUri())

  return url.toString()
}

export async function exchangeTodoistAuthorizationCode(code: string) {
  const body = new URLSearchParams({
    client_id: getEnvValue('TODOIST_CLIENT_ID'),
    client_secret: getEnvValue('TODOIST_CLIENT_SECRET'),
    code,
    redirect_uri: getRedirectUri()
  })

  const response = await fetch(TODOIST_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  })

  if (!response.ok) {
    throw badRequestError('Failed to exchange Todoist authorization code', {
      status: response.status
    })
  }

  const payload = await response.json()
  return todoistTokenSchema.parse(payload)
}

export async function refreshTodoistAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: getEnvValue('TODOIST_CLIENT_ID'),
    client_secret: getEnvValue('TODOIST_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })

  const response = await fetch(TODOIST_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  })

  if (!response.ok) {
    throw badRequestError('Failed to refresh Todoist access token', {
      status: response.status
    })
  }

  const payload = await response.json()
  return todoistTokenSchema.parse(payload)
}

export interface TodoistUserProfile {
  todoistUserId: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  timezone: string | null
}

export async function fetchTodoistUserProfile(accessToken: string): Promise<TodoistUserProfile> {
  const headers = {
    authorization: `Bearer ${accessToken}`
  }

  let response = await fetch(TODOIST_USER_URL, { headers })

  // Compatibility fallback for older API behavior.
  if (!response.ok && (response.status === 404 || response.status === 410)) {
    response = await fetch(TODOIST_LEGACY_USER_URL, { headers })
  }

  if (!response.ok) {
    logger.error('todoist_profile_fetch_failed', {
      status: response.status,
      statusText: response.statusText
    })
    throw badRequestError('Failed to fetch Todoist profile', {
      status: response.status
    })
  }

  const payload = todoistUserSchema.parse(await response.json())

  if (!payload.email) {
    throw badRequestError(API_ERROR_MESSAGE.BAD_REQUEST, {
      reason: 'Todoist profile is missing email'
    })
  }

  return {
    todoistUserId: payload.id,
    email: payload.email,
    displayName: payload.full_name ?? null,
    avatarUrl: payload.avatar_big ?? null,
    timezone: payload.tz_info?.timezone ?? null
  }
}
