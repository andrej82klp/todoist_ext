import { eq } from 'drizzle-orm'

import type { DatabaseClient } from '../db/client'
import { getDb } from '../db/client'
import { webhookDeliveries } from '../db/schema'

export interface CreateWebhookDeliveryInput {
  userId?: string | null
  deliveryKey: string
  eventKey: string
  status: string
  payload?: Record<string, unknown>
}

async function insertDelivery(tx: DatabaseClient, input: CreateWebhookDeliveryInput) {
  const [row] = await tx.insert(webhookDeliveries)
    .values({
      userId: input.userId ?? null,
      deliveryKey: input.deliveryKey,
      eventKey: input.eventKey,
      status: input.status,
      payload: input.payload ?? {}
    })
    .onConflictDoNothing()
    .returning()

  return row ?? null
}

async function updateStatus(tx: DatabaseClient, id: string, status: string) {
  const [row] = await tx.update(webhookDeliveries)
    .set({
      status,
      updatedAt: new Date(),
      processedAt: new Date()
    })
    .where(eq(webhookDeliveries.id, id))
    .returning()

  return row ?? null
}

export const webhookDeliveriesRepository = {
  async findByDeliveryKey(deliveryKey: string) {
    const db = getDb()
    const [row] = await db.select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryKey, deliveryKey))
      .limit(1)

    return row ?? null
  },

  async findByEventKey(eventKey: string) {
    const db = getDb()
    const [row] = await db.select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.eventKey, eventKey))
      .limit(1)

    return row ?? null
  },

  async create(input: CreateWebhookDeliveryInput) {
    const db = getDb()
    return insertDelivery(db, input)
  },

  async createInTransaction(tx: DatabaseClient, input: CreateWebhookDeliveryInput) {
    return insertDelivery(tx, input)
  },

  async updateStatusById(id: string, status: string) {
    const db = getDb()
    return updateStatus(db, id, status)
  },

  async updateStatusByIdInTransaction(tx: DatabaseClient, id: string, status: string) {
    return updateStatus(tx, id, status)
  }
}
