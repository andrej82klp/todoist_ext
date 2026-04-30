import 'dotenv/config'

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import logoutHandler from '../../server/api/auth/logout.post'
import sessionHandler from '../../server/api/auth/session.get'
import protectedHandler from '../../server/api/internal/test-auth/protected.get'
import devSessionHandler from '../../server/api/internal/test-auth/session.post'
import { closeDbConnection, getDb } from '../../server/db/client'
import { users } from '../../server/db/schema'
import sessionMiddleware from '../../server/middleware/session'

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'milestone-4-test-secret'

  const app = createApp()

  app.use(sessionMiddleware)
  app.use('/api/auth/session', sessionHandler)
  app.use('/api/auth/logout', logoutHandler)
  app.use('/api/internal/test-auth/session', devSessionHandler)
  app.use('/api/internal/test-auth/protected', protectedHandler)

  server = createServer(toNodeListener(app))

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })

  await closeDbConnection()
})

describe('Milestone 4 session foundation', () => {
  it('returns an unauthenticated session state when no session cookie exists', async () => {
    const response = await fetch(`${baseUrl}/api/auth/session`)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      data: {
        authenticated: false,
        user: null,
        initialSyncCompleted: false
      }
    })
  })

  it('rejects protected routes with 401 when no session exists', async () => {
    const response = await fetch(`${baseUrl}/api/internal/test-auth/protected`)
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.error.code).toBe('UNAUTHORIZED')
  })

  runIfDatabaseConfigured('supports a simulated authenticated session in dev/test and clears it on logout', async () => {
    const db = getDb()
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const todoistUserId = `session-${testSuffix}`
    const email = `session-${testSuffix}@example.com`

    const createSessionResponse = await fetch(`${baseUrl}/api/internal/test-auth/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        todoistUserId,
        email,
        displayName: 'Session Test User',
        timezone: 'UTC'
      })
    })

    const setCookie = createSessionResponse.headers.get('set-cookie')
    const createPayload = await createSessionResponse.json()

    expect(createSessionResponse.status).toBe(200)
    expect(setCookie).toContain('todoist_companion_session=')
    expect(createPayload.data.authenticated).toBe(true)

    const cookieHeader = setCookie?.split(';', 1)[0] ?? ''

    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: {
        cookie: cookieHeader
      }
    })
    const sessionPayload = await sessionResponse.json()

    expect(sessionResponse.status).toBe(200)
    expect(sessionPayload.data.authenticated).toBe(true)
    expect(sessionPayload.data.user.email).toBe(email)

    const protectedResponse = await fetch(`${baseUrl}/api/internal/test-auth/protected`, {
      headers: {
        cookie: cookieHeader
      }
    })
    const protectedPayload = await protectedResponse.json()

    expect(protectedResponse.status).toBe(200)
    expect(protectedPayload.data.user.email).toBe(email)

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: cookieHeader
      }
    })
    const logoutPayload = await logoutResponse.json()

    expect(logoutResponse.status).toBe(200)
    expect(logoutPayload.data.success).toBe(true)
    expect(logoutResponse.headers.get('set-cookie')).toContain('Max-Age=0')

    await db.delete(users).where(eq(users.todoistUserId, todoistUserId))
  })
})
