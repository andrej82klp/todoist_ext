import { sendRedirect } from 'h3'
import { z } from 'zod'

import { ensureUserDefaults } from '../../../db/defaults'
import { oauthAccountsRepository } from '../../../repositories/oauth-accounts'
import { usersRepository } from '../../../repositories/users'
import { exchangeTodoistAuthorizationCode, fetchTodoistUserProfile } from '../../../services/todoist/oauth'
import { todoistSyncService } from '../../../services/todoist/todoistSyncService'
import { badRequestError, defineApiHandler, internalServerError, tooManyRequestsError } from '../../../utils/api'
import { logger } from '../../../utils/logger'
import { consumeTodoistOauthState } from '../../../utils/oauth-state'
import { checkRateLimit, createRateLimiter } from '../../../utils/rate-limit'
import { setAppSession } from '../../../utils/session'
import { parseQueryWithSchema } from '../../../utils/validation'

// 10 OAuth callback attempts per IP per minute to guard against replay/flooding.
const callbackLimiter = createRateLimiter({ windowMs: 60_000, max: 10 })

const oauthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional()
}).strict()

export default defineApiHandler(async (event) => {
  if (!checkRateLimit(callbackLimiter, event, 'per-ip')) {
    throw tooManyRequestsError()
  }

  const query = parseQueryWithSchema(event, oauthCallbackQuerySchema)

  if (query.error) {
    throw badRequestError('Todoist OAuth was not authorized', {
      todoistError: query.error
    })
  }

  if (!query.code || !query.state) {
    throw badRequestError('Missing OAuth callback parameters')
  }

  const stateIsValid = consumeTodoistOauthState(event, query.state)

  if (!stateIsValid) {
    throw badRequestError('OAuth state is invalid or expired')
  }

  const token = await exchangeTodoistAuthorizationCode(query.code)
  const profile = await fetchTodoistUserProfile(token.access_token)

  const user = await usersRepository.upsertByTodoistUserId({
    todoistUserId: profile.todoistUserId,
    email: profile.email,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    timezone: profile.timezone
  })

  if (!user) {
    throw internalServerError('Failed to create or update local user after OAuth callback')
  }

  await ensureUserDefaults(user.id)

  await oauthAccountsRepository.upsertTodoistAccount({
    userId: user.id,
    providerUserId: profile.todoistUserId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    scope: token.scope ?? null,
    tokenType: token.token_type ?? null,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null
  })

  setAppSession(event, user.id)

  logger.info('oauth_session_established', { userId: user.id })

  todoistSyncService.runInitialSync(user.id, token.access_token).catch((err: unknown) => {
    logger.error('todoist_sync_kickoff_failed', {
      userId: user.id,
      message: err instanceof Error ? err.message : String(err)
    })
  })

  return sendRedirect(event, '/', 302)
})
