// Summary: Tests for shared API contract endpoints and error normalization.
// Verifies: single-resource, collection, and action envelopes; validation errors; API error normalization helpers.
// Requires: local HTTP server (spun up by tests). Set DATABASE_URL to a test DB for full integration runs if needed.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createApp, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { API_ERROR_STATUS,
  API_ERROR_MESSAGE,
  TASK_SORT_FIELDS
} from '../../shared/constants/api'
import actionHandler from '../../server/api/internal/test-contract/action.post'
import collectionHandler from '../../server/api/internal/test-contract/collection.get'
import successHandler from '../../server/api/internal/test-contract/success.get'
import validationHandler from '../../server/api/internal/test-contract/validation.post'
import {
  badRequestError,
  conflictError,
  forbiddenError,
  normalizeApiError,
  notFoundError,
  unauthorizedError
} from '../../server/utils/api'

let server: ReturnType<typeof createServer>
let baseUrl = ''

// Setup: boots a local H3 server with the contract test handlers used below.
// Starts an HTTP server on localhost with an ephemeral port so tests can fetch handlers.
beforeAll(async () => {
  const app = createApp()

  app.use('/api/internal/test-contract/success', successHandler)
  app.use('/api/internal/test-contract/collection', collectionHandler)
  app.use('/api/internal/test-contract/action', actionHandler)
  app.use('/api/internal/test-contract/validation', validationHandler)

  server = createServer(toNodeListener(app))

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error: unknown) => error ? reject(error) : resolve())
  })
})

// Suite: validates the shared API envelope contracts (single, collection, action, validation).
describe('Milestone 3 shared contract endpoints', () => {
  // Test: returns a single-resource envelope matching the documented shape.
  it('returns the documented single-resource envelope', async () => {
    const response = await fetch(`${baseUrl}/api/internal/test-contract/success`)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      data: {
        kind: 'single',
        ok: true
      }
    })
  })

  // Test: returns a collection envelope with meta and expected item count.
  it('returns the documented collection envelope', async () => {
    const response = await fetch(`${baseUrl}/api/internal/test-contract/collection`)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.meta).toEqual({ page: 1, pageSize: 2, total: 2 })
    expect(payload.data).toHaveLength(2)
  })

  // Test: action endpoint returns a success envelope with message and flag.
  it('returns the documented action envelope', async () => {
    const response = await fetch(`${baseUrl}/api/internal/test-contract/action`, {
      method: 'POST'
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      data: {
        success: true,
        message: 'Contract action executed'
      }
    })
  })

  // Test: validation errors are returned with field-level messages and 422 status.
  it('returns a 422 validation envelope with field-level details', async () => {
    const response = await fetch(`${baseUrl}/api/internal/test-contract/validation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        difficulty: 11,
        completionBonusPercent: -1
      })
    })
    const payload = await response.json()

    expect(response.status).toBe(API_ERROR_STATUS.VALIDATION_ERROR)
    expect(payload.error.code).toBe('VALIDATION_ERROR')
    expect(payload.error.message).toBe(API_ERROR_MESSAGE.VALIDATION_ERROR)
    expect(payload.error.details.fields.difficulty).toContain('Too big: expected number to be <=10')
    expect(payload.error.details.fields.completionBonusPercent).toContain('Too small: expected number to be >=0')
  })
})

describe('Milestone 3 error normalization helpers', () => {
  it('maps the common API errors to the documented status codes', () => {
    expect(normalizeApiError(badRequestError()).statusCode).toBe(400)
    expect(normalizeApiError(unauthorizedError()).statusCode).toBe(401)
    expect(normalizeApiError(forbiddenError()).statusCode).toBe(403)
    expect(normalizeApiError(notFoundError()).statusCode).toBe(404)
    expect(normalizeApiError(conflictError()).statusCode).toBe(409)
  })

  it('keeps the sorting allowlist explicit and shared', () => {
    expect(TASK_SORT_FIELDS).toEqual(['priority', 'difficulty', 'estimatedPoints', 'deadline'])
  })
})
