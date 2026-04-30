import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'
import { z } from 'zod'

import type { AuthSessionState, SessionUser } from '../../shared/types'
import type { User } from '../db/schema'
import { itemMappingsRepository } from '../repositories/item-mappings'
import { usersRepository } from '../repositories/users'
import { internalServerError, unauthorizedError } from './api'

const SESSION_COOKIE_NAME = 'todoist_companion_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30
const SESSION_COOKIE_PATH = '/'
const DEV_SESSION_SECRET = 'dev-session-secret-change-me'

const sessionPayloadSchema = z.object({
  version: z.literal(1),
  userId: z.string().uuid(),
  createdAt: z.string().datetime()
}).strict()

export type AppSession = z.infer<typeof sessionPayloadSchema>

interface SessionContextCache {
  appSession?: AppSession | null
  currentUser?: User | null
}

function getSessionContext(event: H3Event): H3Event['context'] & SessionContextCache {
  return event.context as H3Event['context'] & SessionContextCache
}

function getSessionSecret() {
  const configuredSecret = process.env.SESSION_SECRET

  if (configuredSecret && configuredSecret.length > 0) {
    return configuredSecret
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEV_SESSION_SECRET
  }

  throw internalServerError('SESSION_SECRET is not configured')
}

function getSessionKey() {
  return createHash('sha256').update(getSessionSecret()).digest()
}

function shouldUseSecureCookie() {
  return process.env.NODE_ENV === 'production'
}

function encodeSession(session: AppSession) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getSessionKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv, authTag, ciphertext].map(part => part.toString('base64url')).join('.')
}

function decodeSession(serializedSession: string) {
  try {
    const [ivPart, tagPart, payloadPart] = serializedSession.split('.')

    if (!ivPart || !tagPart || !payloadPart) {
      return null
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      getSessionKey(),
      Buffer.from(ivPart, 'base64url')
    )

    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payloadPart, 'base64url')),
      decipher.final()
    ])

    return sessionPayloadSchema.parse(JSON.parse(plaintext.toString('utf8')))
  } catch {
    return null
  }
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: shouldUseSecureCookie(),
    path: SESSION_COOKIE_PATH
  }
}

export function setAppSession(event: H3Event, userId: string) {
  const session: AppSession = {
    version: 1,
    userId,
    createdAt: new Date().toISOString()
  }

  setCookie(event, SESSION_COOKIE_NAME, encodeSession(session), {
    ...getSessionCookieOptions(),
    maxAge: SESSION_DURATION_SECONDS
  })

  getSessionContext(event).appSession = session

  return session
}

export function clearAppSession(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE_NAME, getSessionCookieOptions())

  const context = getSessionContext(event)
  context.appSession = null
  context.currentUser = null
}

export function getAppSession(event: H3Event) {
  const context = getSessionContext(event)

  if (context.appSession !== undefined) {
    return context.appSession
  }

  const serializedSession = getCookie(event, SESSION_COOKIE_NAME)
  const session = serializedSession ? decodeSession(serializedSession) : null

  context.appSession = session

  if (!session && serializedSession) {
    clearAppSession(event)
  }

  return session
}

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone
  }
}

export async function getCurrentUser(event: H3Event) {
  const context = getSessionContext(event)

  if (context.currentUser !== undefined) {
    return context.currentUser
  }

  const session = getAppSession(event)

  if (!session) {
    context.currentUser = null
    return null
  }

  const user = await usersRepository.findById(session.userId)

  if (!user) {
    clearAppSession(event)
    return null
  }

  context.currentUser = user

  return user
}

export async function requireCurrentUser(event: H3Event) {
  const user = await getCurrentUser(event)

  if (!user) {
    throw unauthorizedError()
  }

  return user
}

export function createUnauthenticatedSessionState(): AuthSessionState {
  return {
    authenticated: false,
    user: null,
    initialSyncCompleted: false
  }
}

export async function buildAuthSessionState(event: H3Event): Promise<AuthSessionState> {
  const user = await getCurrentUser(event)

  if (!user) {
    return createUnauthenticatedSessionState()
  }

  const syncedCount = await itemMappingsRepository.countByUserId(user.id)

  return {
    authenticated: true,
    user: toSessionUser(user),
    initialSyncCompleted: syncedCount > 0
  }
}
