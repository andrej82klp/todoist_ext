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

const runIfDatabaseConfigured = process.env.DATABASE_URL ? it : it.skip

let server: ReturnType<typeof createServer>
let baseUrl = ''

function signPayload(payload: string) {
  const secret = process.env.TODOIST_CLIENT_SECRET ?? 'milestone-13-test-client-secret'
  return createHmac('sha256', secret).update(payload).digest('base64')
}

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

beforeAll(async () => {
  process.env.TODOIST_CLIENT_SECRET ||= 'milestone-13-test-client-secret'

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

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve())
  })
  await closeDbConnection()
})

describe('Milestone 13 — Todoist webhook endpoint', () => {
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

  runIfDatabaseConfigured('processes completion events idempotently and applies one-time task bonus', async () => {
    const db = getDb()
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const [user] = await db.insert(users).values({
      email: `webhook-${suffix}@example.com`,
      todoistUserId: `webhook-${suffix}`
    }).returning()

    try {
      await ensureUserDefaults(user.id)

      const mappings = await itemMappingsRepository.upsertMany(user.id, [
        {
          todoistItemId: 'project-1',
          itemType: 'project',
          title: 'Webhook Project'
        },
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

      const parentMapping = mappings.find(m => m.todoistItemId === 'task-parent')!
      const subtaskOneMapping = mappings.find(m => m.todoistItemId === 'subtask-1')!
      const subtaskTwoMapping = mappings.find(m => m.todoistItemId === 'subtask-2')!

      await tasksRepository.upsertTaskMetadata(user.id, parentMapping.id, {
        priority: 'high',
        difficulty: 4,
        timeEstimateMinutes: null,
        completionBonusEnabled: true,
        completionBonusPercent: 10,
        badge: null,
        customPointOverride: null
      })

      await tasksRepository.upsertTaskMetadata(user.id, subtaskOneMapping.id, {
        priority: 'medium',
        difficulty: 2,
        timeEstimateMinutes: null,
        completionBonusEnabled: false,
        completionBonusPercent: 0,
        badge: null,
        customPointOverride: null
      })

      await tasksRepository.upsertTaskMetadata(user.id, subtaskTwoMapping.id, {
        priority: 'medium',
        difficulty: 2,
        timeEstimateMinutes: null,
        completionBonusEnabled: false,
        completionBonusPercent: 0,
        badge: null,
        customPointOverride: null
      })

      const firstResult = await sendWebhook({
        event_name: 'item:completed',
        event_id: 'evt-subtask-1',
        event_data: {
          id: 'subtask-1',
          user_id: user.todoistUserId,
          checked: true
        }
      }, {
        deliveryId: 'delivery-subtask-1'
      })

      expect(firstResult.response.status).toBe(200)
      expect(firstResult.payload.data.received).toBe(true)

      const duplicateResult = await sendWebhook({
        event_name: 'item:completed',
        event_id: 'evt-subtask-1',
        event_data: {
          id: 'subtask-1',
          user_id: user.todoistUserId,
          checked: true
        }
      }, {
        deliveryId: 'delivery-subtask-1-duplicate'
      })

      expect(duplicateResult.response.status).toBe(200)
      expect(duplicateResult.payload.data.received).toBe(true)

      const secondResult = await sendWebhook({
        event_name: 'item:completed',
        event_id: 'evt-subtask-2',
        event_data: {
          id: 'subtask-2',
          user_id: user.todoistUserId,
          checked: true
        }
      }, {
        deliveryId: 'delivery-subtask-2'
      })

      expect(secondResult.response.status).toBe(200)
      expect(secondResult.payload.data.received).toBe(true)

      const ledgerRows = await db.select().from(pointLedger).where(eq(pointLedger.userId, user.id))
      const balanceRow = await db.select().from(pointBalances).where(eq(pointBalances.userId, user.id))
      const parentTask = await itemMappingsRepository.findByUserIdAndTodoistItemId(user.id, 'task-parent')
      const deliveryRows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.userId, user.id))

      expect(ledgerRows).toHaveLength(3)
      expect(ledgerRows.filter(row => row.transactionType === 'earned')).toHaveLength(2)
      expect(ledgerRows.filter(row => row.transactionType === 'bonus')).toHaveLength(1)

      expect(balanceRow[0]?.currentBalance).toBe(56)
      expect(parentTask?.isCompleted).toBe(true)

      expect(deliveryRows).toHaveLength(3)
      expect(deliveryRows.every(row => row.status === 'processed')).toBe(true)
    } finally {
      await db.delete(users).where(eq(users.id, user.id))
    }
  })
})
