import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { and, eq } from 'drizzle-orm'
import { createApp, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import callbackHandler from '../../server/api/auth/todoist/callback.get'
import startHandler from '../../server/api/auth/todoist/start.get'
import sessionHandler from '../../server/api/auth/session.get'
import { closeDbConnection, getDb } from '../../server/db/client'
import { oauthAccounts, users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'
import { fetchTodoistUserProfile } from '../../server/services/todoist/oauth'
import { decryptSecret } from '../../server/utils/secrets'

// Summary: Tests the Todoist OAuth start/callback flow and Todoist profile fetch service behavior.
// Verifies: end-to-end auth/session persistence, invalid state rejection, and profile mapping/fallback handling.
// Requires: DATABASE_URL for integration path; TODOIST_* env vars are set to test values during setup.
// Helper: toggles database-backed integration tests when `DATABASE_URL` is present.
const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

// Helper: extracts a single cookie key/value pair from a Set-Cookie header for request replay.
function extractCookieValue(setCookieHeader: string | null, cookieName: string) {
  if (!setCookieHeader) {
    return null
  }

  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]+)`))

  return match ? `${cookieName}=${match[1]}` : null
}

// Setup: configures auth env defaults and boots a local H3 server with session + auth routes.
beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-5-test-secret'
  process.env.TODOIST_CLIENT_ID ||= 'test-client-id'
  process.env.TODOIST_CLIENT_SECRET ||= 'test-client-secret'
  process.env.TODOIST_REDIRECT_URI ||= 'http://127.0.0.1:9999/api/auth/todoist/callback'

  const app = createApp()

  app.use(sessionMiddleware)
  app.use('/api/auth/todoist/start', startHandler)
  app.use('/api/auth/todoist/callback', callbackHandler)
  app.use('/api/auth/session', sessionHandler)

  server = createServer(toNodeListener(app))

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

// Cleanup: shuts down the HTTP server and closes DB connections to avoid cross-test leakage.
afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })

  await closeDbConnection()
})

// Suite: covers OAuth handshake integrity and persistence of user/account/session state.
// Suite: exercises the OAuth start/callback flow and profile exchange.
describe('Milestone 5 Todoist OAuth flow', () => {
  // Test (integration): verifies full OAuth round-trip, token exchange, and session persistence.
  runIfDatabaseConfigured('starts OAuth and completes callback with persisted account and session', async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url === 'https://api.todoist.com/oauth/access_token') {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'content-type': 'application/x-www-form-urlencoded'
        })
        expect(init?.body).toBeInstanceOf(URLSearchParams)
        expect((init?.body as URLSearchParams).get('code')).toBe('test-auth-code')

        return new Response(JSON.stringify({
          access_token: 'todoist-access-token',
          token_type: 'Bearer',
          scope: 'data:read'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      if (url === 'https://api.todoist.com/api/v1/user') {
        return new Response(JSON.stringify({
          id: 'todoist-user-123',
          email: 'oauth-user@example.com',
          full_name: 'OAuth User',
          avatar_big: 'https://example.com/avatar.png',
          tz_info: { timezone: 'UTC' }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      return originalFetch(input, init)
    }

    try {
      const startResponse = await fetch(`${baseUrl}/api/auth/todoist/start`, {
        redirect: 'manual'
      })

      expect(startResponse.status).toBe(302)

      const startLocation = startResponse.headers.get('location')
      expect(startLocation).toBeTruthy()
      expect(startLocation).toContain('https://app.todoist.com/oauth/authorize')

      const startCookie = startResponse.headers.get('set-cookie')
      expect(startCookie).toContain('todoist_oauth_state=')

      const oauthState = new URL(startLocation!).searchParams.get('state')
      expect(oauthState).toBeTruthy()

      const stateCookieHeader = startCookie?.split(';', 1)[0] ?? ''

      const callbackResponse = await fetch(
        `${baseUrl}/api/auth/todoist/callback?code=test-auth-code&state=${encodeURIComponent(oauthState!)}`,
        {
          redirect: 'manual',
          headers: {
            cookie: stateCookieHeader
          }
        }
      )

      expect(callbackResponse.status).toBe(302)
      expect(callbackResponse.headers.get('location')).toBe('/')

      const callbackCookie = callbackResponse.headers.get('set-cookie')
      expect(callbackCookie).toContain('todoist_companion_session=')

      const sessionCookieHeader = extractCookieValue(callbackCookie, 'todoist_companion_session') ?? ''

      const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
        headers: {
          cookie: sessionCookieHeader
        }
      })
      const sessionPayload = await sessionResponse.json()

      expect(sessionResponse.status).toBe(200)
      expect(sessionPayload.data.authenticated).toBe(true)
      expect(sessionPayload.data.user.email).toBe('oauth-user@example.com')

      const db = getDb()
      // DB check: confirms user provisioning happened from OAuth profile identity.
      const [storedUser] = await db.select().from(users)
        .where(eq(users.todoistUserId, 'todoist-user-123'))
        .limit(1)

      expect(storedUser).toBeTruthy()

      const [storedOauth] = await db.select().from(oauthAccounts)
        .where(and(eq(oauthAccounts.userId, storedUser!.id), eq(oauthAccounts.provider, 'todoist')))
        .limit(1)

      expect(storedOauth).toBeTruthy()
      // Security invariant: access tokens are persisted encrypted, never in plaintext.
      expect(storedOauth!.accessToken).not.toBe('todoist-access-token')
      expect(decryptSecret(storedOauth!.accessToken)).toBe('todoist-access-token')

      // Cleanup: remove inserted user row so reruns stay deterministic.
      await db.delete(users).where(eq(users.id, storedUser!.id))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // Unit/integration boundary: invalid or missing state must fail to prevent forged callbacks.
  it('rejects callback when OAuth state is missing or invalid', async () => {
    const response = await fetch(`${baseUrl}/api/auth/todoist/callback?code=test&state=wrong-state`)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error.code).toBe('BAD_REQUEST')
  })
})

// Suite: validates Todoist profile service mapping and resilience across API responses.
describe('Milestone 5 fetchTodoistUserProfile service', () => {
  // Unit: ensures external Todoist payload fields are normalized to internal profile shape.
  it('maps the Todoist profile payload to the app profile shape', async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      expect(url).toBe('https://api.todoist.com/api/v1/user')
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer profile-test-token'
      })

      return new Response(JSON.stringify({
        id: 123,
        email: 'profile-user@example.com',
        full_name: 'Profile User',
        avatar_big: 'https://example.com/profile.png',
        tz_info: { timezone: 'Europe/Berlin' }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }

    try {
      await expect(fetchTodoistUserProfile('profile-test-token')).resolves.toEqual({
        todoistUserId: '123',
        email: 'profile-user@example.com',
        displayName: 'Profile User',
        avatarUrl: 'https://example.com/profile.png',
        timezone: 'Europe/Berlin'
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // Unit: non-2xx responses are translated into a BAD_REQUEST domain error contract.
  it('throws BAD_REQUEST when Todoist profile API returns a non-2xx response', async () => {
    const originalFetch = globalThis.fetch
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    globalThis.fetch = async () => new Response('Unauthorized', {
      status: 401,
      statusText: 'Unauthorized'
    })

    try {
      await expect(fetchTodoistUserProfile('invalid-token')).rejects.toMatchObject({
        name: 'ApiHttpError',
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Failed to fetch Todoist profile',
        details: {
          status: 401
        }
      })
    } finally {
      globalThis.fetch = originalFetch
      consoleErrorSpy.mockRestore()
    }
  })

  // Unit edge case: if the current endpoint is retired, service falls back to legacy endpoint.
  it('falls back to legacy profile endpoint when current endpoint is gone', async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url === 'https://api.todoist.com/api/v1/user') {
        return new Response('Gone', {
          status: 410,
          statusText: 'Gone'
        })
      }

      if (url === 'https://api.todoist.com/sync/v9/user') {
        return new Response(JSON.stringify({
          id: 'legacy-user-id',
          email: 'legacy-user@example.com',
          full_name: 'Legacy User',
          avatar_big: 'https://example.com/legacy.png',
          tz_info: { timezone: 'UTC' }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      return new Response('Not found', { status: 404 })
    }

    try {
      await expect(fetchTodoistUserProfile('legacy-token')).resolves.toEqual({
        todoistUserId: 'legacy-user-id',
        email: 'legacy-user@example.com',
        displayName: 'Legacy User',
        avatarUrl: 'https://example.com/legacy.png',
        timezone: 'UTC'
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
