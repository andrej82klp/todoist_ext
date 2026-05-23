// Tests for the Todoist webhook POST endpoint.
// Verifies signature checking and end-to-end processing for completion events,
// including idempotent handling and awarding points/bonuses when subtasks complete.
import 'dotenv/config'

import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import webhookPostHandler from '../../server/api/todoist/webhook.post'
import { closeDbConnection, getDb } from '../../server/db/client'
import { ensureUserDefaults } from '../../server/db/defaults'
import { pointBalances, pointLedger, users, webhookDeliveries } from '../../server/db/schema'
import { itemMappingsRepository } from '../../server/repositories/item-mappings'
import { tasksRepository } from '../../server/repositories/tasks'

// Helper: toggles DB-backed tests when `DATABASE_URL` is present in the environment.
const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''
// Helper: produce the HMAC signature expected by the webhook handler.
// Uses the same secret resolution policy as the webhook service.
// If `TODOIST_WEBHOOK_SECRET` is set, it takes precedence; otherwise we fall
// back to `TODOIST_CLIENT_SECRET`.
function signPayload(payload: string) {
  const secret = process.env.TODOIST_WEBHOOK_SECRET
    ?? process.env.TODOIST_CLIENT_SECRET
    ?? 'milestone-13-test-client-secret'
  return createHmac('sha256', secret).update(payload).digest('base64')
}

// Helper: POST a webhook payload to the local test server.
// Adds the required Todoist headers (`x-todoist-delivery-id`, `x-todoist-hmac-sha256`)
// and returns both the raw fetch `response` and parsed JSON body.
async function sendWebhook(payload: Record<string, unknown>, options: { deliveryId: string, signature?: string }) {
  const rawBody = JSON.stringify(payload)
  const signature = options.signature ?? signPayload(rawBody)

  const response = await fetch(`${baseUrl}/api/todoist/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-todoist-delivery-id': options.deliveryId,
      'x-todoist-hmac-sha256': signature
    },
    body: rawBody
  })

  return {
    response,
    payload: await response.json()
  }
}

// Set up a minimal HTTP server that mounts the webhook route handler.
// This lets tests call the API over HTTP exactly like production.
// Setup: starts a local server and configures secrets used to validate webhook signatures.
// Tests use `signPayload` to generate expected HMACs for the payloads they post.
beforeAll(async () => {
  // Keep both env vars aligned so signature checks stay deterministic even when
  // local dotenv files define both values differently.
  process.env.TODOIST_CLIENT_SECRET = 'milestone-13-test-client-secret'
  process.env.TODOIST_WEBHOOK_SECRET = process.env.TODOIST_CLIENT_SECRET

  const app = createApp()
  const router = createRouter()
  router.post('/api/todoist/webhook', webhookPostHandler)
  app.use(router)

  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

// Tear down the HTTP server and close DB connections after tests finish.
afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve())
  })
  await closeDbConnection()
})

describe('Milestone 13 — Todoist webhook endpoint', () => {
  // Unit test: ensure the endpoint rejects requests with invalid HMAC signatures.
  // This validates the security guard that prevents accepting forged webhooks.
  it('rejects invalid webhook signatures', async () => {
    const result = await sendWebhook({
      event_name: 'item:completed',
      event_id: 'evt-invalid',
      event_data: {
        id: 'task-1',
        user_id: 'todoist-user-1',
        checked: true
      }
    }, {
      deliveryId: 'delivery-invalid',
      signature: 'invalid-signature'
    })

    expect(result.response.status).toBe(401)
    expect(result.payload.error.code).toBe('UNAUTHORIZED')
  })

  // Integration test (DB required):
  // - simulates Todoist completion events for subtasks
  // - checks idempotent processing of duplicate events
  // - verifies parent task completion triggers a one-time bonus
  runIfDatabaseConfigured('processes completion events idempotently and applies one-time task bonus', async () => {
    const db = getDb()
    // Get DB handle for creating test entities and querying results.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const eventSubtaskOne = `evt-subtask-1-${suffix}`
    const eventSubtaskTwo = `evt-subtask-2-${suffix}`
    const deliverySubtaskOne = `delivery-subtask-1-${suffix}`
    const deliverySubtaskOneDuplicate = `delivery-subtask-1-duplicate-${suffix}`
    const deliverySubtaskTwo = `delivery-subtask-2-${suffix}`

    // Create an isolated test user with a unique `todoistUserId`.
    const [user] = await db.insert(users).values({
      email: `webhook-${suffix}@example.com`,
      todoistUserId: `webhook-${suffix}`
    }).returning()

    try {
      // Ensure required default rows (settings, balances, etc.) exist for the user.
      await ensureUserDefaults(user.id)

      // Insert todoist item mappings for parent and subtasks.
      const mappings = await itemMappingsRepository.upsertMany(user.id, [
        {
          todoistItemId: 'task-parent',
          itemType: 'task',
          title: 'Parent task',
          projectTodoistId: 'project-1',
          isCompleted: false
        },
        {
          todoistItemId: 'subtask-1',
          itemType: 'subtask',
          title: 'Subtask one',
          parentTodoistItemId: 'task-parent',
          projectTodoistId: 'project-1',
          isCompleted: false
        },
        {
          todoistItemId: 'subtask-2',
          itemType: 'subtask',
          title: 'Subtask two',
          parentTodoistItemId: 'task-parent',
          projectTodoistId: 'project-1',
          isCompleted: false
        }
      ])

      // Grab the inserted mapping rows so we can reference their internal IDs.
      const parentMapping = mappings.find(m => m.todoistItemId === 'task-parent')!
      const subtaskOneMapping = mappings.find(m => m.todoistItemId === 'subtask-1')!
      const subtaskTwoMapping = mappings.find(m => m.todoistItemId === 'subtask-2')!

      // Configure metadata for the parent task:
      // - `priority: high` and `difficulty: 4` set the base points.
      // - `completionBonusEnabled: true` with 10% will award a one-time bonus
      //   when all subtasks are completed and the parent is marked complete.
      await tasksRepository.upsertTaskMetadata(user.id, parentMapping.id, {
        priority: 'high',
        difficulty: 4,
        timeEstimateMinutes: null,
        completionBonusEnabled: true,
        completionBonusPercent: 10,
        badge: null,
        customPointOverride: null
      })

      // Configure metadata for subtask 1: medium difficulty -> smaller earned points.
      await tasksRepository.upsertTaskMetadata(user.id, subtaskOneMapping.id, {
        priority: 'medium',
        difficulty: 2,
        timeEstimateMinutes: null,
        completionBonusEnabled: false,
        completionBonusPercent: 0,
        badge: null,
        customPointOverride: null
      })

      // Configure metadata for subtask 2: same as subtask 1.
      await tasksRepository.upsertTaskMetadata(user.id, subtaskTwoMapping.id, {
        priority: 'medium',
        difficulty: 2,
        timeEstimateMinutes: null,
        completionBonusEnabled: false,
        completionBonusPercent: 0,
        badge: null,
        customPointOverride: null
      })

      // 1) Send a completion event for `subtask-1`.
      // The webhook includes an explicit `event_id` which is used for idempotency.
      const firstResult = await sendWebhook({
        event_name: 'item:completed',
        event_id: eventSubtaskOne,
        event_data: {
          id: 'subtask-1',
          user_id: user.todoistUserId,
          checked: true
        }
      }, {
        deliveryId: deliverySubtaskOne
      })

      expect(firstResult.response.status).toBe(200)
      expect(firstResult.payload.data.received).toBe(true)

      // 2) Send a duplicate event with the same `event_id` but a different delivery id.
      // The system should detect the duplicate and NOT award points twice.
      const duplicateResult = await sendWebhook({
        event_name: 'item:completed',
        event_id: eventSubtaskOne,
        event_data: {
          id: 'subtask-1',
          user_id: user.todoistUserId,
          checked: true
        }
      }, {
        deliveryId: deliverySubtaskOneDuplicate
      })

      expect(duplicateResult.response.status).toBe(200)
      expect(duplicateResult.payload.data.received).toBe(true)

      // 3) Complete `subtask-2`. After both subtasks are completed the parent
      // task should be marked complete and the configured task completion bonus applied.
      const secondResult = await sendWebhook({
        event_name: 'item:completed',
        event_id: eventSubtaskTwo,
        event_data: {
          id: 'subtask-2',
          user_id: user.todoistUserId,
          checked: true
        }
      }, {
        deliveryId: deliverySubtaskTwo
      })

      expect(secondResult.response.status).toBe(200)
      expect(secondResult.payload.data.received).toBe(true)

      // Query DB to inspect ledger entries, balances, task state, and delivery records.
      const ledgerRows = await db.select().from(pointLedger).where(eq(pointLedger.userId, user.id))
      const balanceRow = await db.select().from(pointBalances).where(eq(pointBalances.userId, user.id))
      const parentTask = await itemMappingsRepository.findByUserIdAndTodoistItemId(user.id, 'task-parent')
      const deliveryRows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.userId, user.id))

      // Expectations:
      // - Two 'earned' transactions (one per subtask).
      // - One 'bonus' transaction (one-time for the parent task).
      // Points math: each subtask => 2 * 10 * 1.25 = 25 points; total subtasks = 50.
      // Parent base points: 4 * 10 * 1.5 = 60; 10% bonus = 6 => final total = 56.
      expect(ledgerRows).toHaveLength(3)
      expect(ledgerRows.filter(row => row.transactionType === 'earned')).toHaveLength(2)
      expect(ledgerRows.filter(row => row.transactionType === 'bonus')).toHaveLength(1)

      // Balance should reflect the two earned amounts plus the single bonus.
      expect(balanceRow[0]?.currentBalance).toBe(56)
      // Parent mapping should now be marked as completed.
      expect(parentTask?.isCompleted).toBe(true)

      // We recorded three webhook deliveries (one per POST) and all should be processed.
      expect(deliveryRows).toHaveLength(3)
      expect(deliveryRows.every(row => row.status === 'processed')).toBe(true)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
