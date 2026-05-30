import { ApiHttpError, badRequestError, defineApiHandler, success, tooManyRequestsError } from '../../utils/api'
import { logger } from '../../utils/logger'
import { oauthAccountsRepository } from '../../repositories/oauth-accounts'
import { refreshTodoistAccessToken } from '../../services/todoist/oauth'
import { todoistSyncService } from '../../services/todoist/todoistSyncService'
import { checkRateLimit, createRateLimiter } from '../../utils/rate-limit'
import { requireCurrentUser } from '../../utils/session'

// Limit manual sync requests to reduce accidental abuse and repeated upstream calls.
const manualSyncLimiter = createRateLimiter({ windowMs: 60_000, max: 5 })

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)

  if (!checkRateLimit(manualSyncLimiter, event, 'per-user', user.id)) {
    throw tooManyRequestsError()
  }

  const credentials = await oauthAccountsRepository.getDecryptedTodoistCredentials(user.id)

  if (!credentials) {
    throw badRequestError('Todoist account is not connected')
  }

  const refreshAccessToken = async () => {
    if (!credentials.refreshToken) {
      throw badRequestError('Todoist session expired. Please reconnect Todoist.')
    }

    const refreshedToken = await refreshTodoistAccessToken(credentials.refreshToken)
    const nextRefreshToken = refreshedToken.refresh_token ?? credentials.refreshToken

    await oauthAccountsRepository.upsertTodoistAccount({
      userId: user.id,
      providerUserId: credentials.providerUserId,
      accessToken: refreshedToken.access_token,
      refreshToken: nextRefreshToken,
      scope: refreshedToken.scope ?? credentials.scope,
      tokenType: refreshedToken.token_type ?? credentials.tokenType,
      tokenExpiresAt: refreshedToken.expires_in
        ? new Date(Date.now() + refreshedToken.expires_in * 1000)
        : credentials.tokenExpiresAt
    })

    credentials.accessToken = refreshedToken.access_token
    credentials.refreshToken = nextRefreshToken
    credentials.scope = refreshedToken.scope ?? credentials.scope
    credentials.tokenType = refreshedToken.token_type ?? credentials.tokenType
    credentials.tokenExpiresAt = refreshedToken.expires_in
      ? new Date(Date.now() + refreshedToken.expires_in * 1000)
      : credentials.tokenExpiresAt

    return credentials.accessToken
  }

  const expiresAtMs = credentials.tokenExpiresAt?.getTime() ?? null
  const tokenLikelyExpired = Boolean(expiresAtMs && expiresAtMs <= Date.now() + 60_000)

  let accessToken = credentials.accessToken

  if (tokenLikelyExpired) {
    accessToken = await refreshAccessToken()
  }

  let result

  try {
    result = await todoistSyncService.runInitialSync(user.id, accessToken)
  } catch (error: unknown) {
    if (!(error instanceof ApiHttpError) || error.statusCode !== 401 || !credentials.refreshToken || tokenLikelyExpired) {
      throw error
    }

    const retriedAccessToken = await refreshAccessToken()
    result = await todoistSyncService.runInitialSync(user.id, retriedAccessToken)
  }

  logger.info('todoist_manual_sync_completed', {
    userId: user.id,
    ...result
  })

  return success(result)
})
