import { desc, eq } from 'drizzle-orm'

import { getDb } from '../db/client'
import { webhookLogs } from '../db/schema'

export interface CreateWebhookLogInput {
  loggedAt?: Date
  type: string
  method?: string | null
  url?: string | null
  headers?: Record<string, unknown> | null
  payload?: unknown | null
  deliveryKey?: string | null
  status?: string | null
  error?: Record<string, unknown> | null
}

export const webhookLogsRepository = {
  async create(input: CreateWebhookLogInput) {
    const db = getDb()
    const [row] = await db.insert(webhookLogs)
      .values({
        loggedAt: input.loggedAt ?? new Date(),
        type: input.type,
        method: input.method ?? null,
        url: input.url ?? null,
        headers: input.headers ?? null,
        payload: input.payload ?? null,
        deliveryKey: input.deliveryKey ?? null,
        status: input.status ?? null,
        error: input.error ?? null
      })
      .returning()

    return row ?? null
  },

  async findByType(type: string, limit = 100) {
    const db = getDb()
    return db.select()
      .from(webhookLogs)
      .where(eq(webhookLogs.type, type))
      .orderBy(desc(webhookLogs.loggedAt))
      .limit(limit)
  },

  async findByDeliveryKey(deliveryKey: string) {
    const db = getDb()
    return db.select()
      .from(webhookLogs)
      .where(eq(webhookLogs.deliveryKey, deliveryKey))
      .orderBy(desc(webhookLogs.loggedAt))
  },

  async findErrors(limit = 100) {
    const db = getDb()
    return db.select()
      .from(webhookLogs)
      .where(eq(webhookLogs.type, 'processing_error'))
      .orderBy(desc(webhookLogs.loggedAt))
      .limit(limit)
  },

  async findRecent(limit = 100) {
    const db = getDb()
    return db.select()
      .from(webhookLogs)
      .orderBy(desc(webhookLogs.loggedAt))
      .limit(limit)
  }
}
