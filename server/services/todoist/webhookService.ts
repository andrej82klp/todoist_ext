import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { DatabaseClient } from '../../db/client'
import { getDb } from '../../db/client'
import { itemMappingsRepository } from '../../repositories/item-mappings'
import { ledgerRepository } from '../../repositories/ledger'
import { settingsRepository } from '../../repositories/settings'
import { streaksRepository } from '../../repositories/streaks'
import type { TaskWithMetaRow } from '../../repositories/tasks'
import { tasksRepository } from '../../repositories/tasks'
import { usersRepository } from '../../repositories/users'
import { webhookDeliveriesRepository } from '../../repositories/webhook-deliveries'
import { badRequestError } from '../../utils/api'
import { logger } from '../../utils/logger'
import {
  calculateCompletionBonus,
  calculateTaskPoints
} from '../points/pointsEngineService'
import { streakService, yesterdayUtc } from '../streaks/streakService'

interface TodoistWebhookPayload {
  event_name?: string
  event_data?: {
    id?: string | number
    item_id?: string | number
    user_id?: string | number
    checked?: boolean
  }
  event_id?: string | number
  user_id?: string | number
  item_id?: string | number
  initiator?: {
    id?: string | number
  }
  initiator_id?: string | number
  triggered_at?: string
}

export interface ProcessTodoistWebhookInput {
  rawBody: string
  deliveryKey: string
}

function getWebhookSecret() {
  const webhookSecret = process.env.TODOIST_WEBHOOK_SECRET

  if (webhookSecret && webhookSecret.length > 0) {
    return webhookSecret
  }

  const clientSecret = process.env.TODOIST_CLIENT_SECRET

  if (!clientSecret || clientSecret.length === 0) {
    throw badRequestError('TODOIST_CLIENT_SECRET is not configured')
  }

  return clientSecret
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeSignature(signature: string) {
  const trimmed = signature.trim()

  if (trimmed.startsWith('sha256=')) {
    return trimmed.slice('sha256='.length)
  }

  return trimmed
}

function toStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function rowToTaskMetadata(row: TaskWithMetaRow) {
  return {
    priority: row.priority,
    difficulty: row.difficulty,
    timeEstimateMinutes: row.timeEstimateMinutes,
    completionBonusEnabled: row.completionBonusEnabled,
    completionBonusPercent: row.completionBonusPercent,
    badge: row.badge,
    customPointOverride: row.customPointOverride
  }
}

function parsePayload(rawBody: string): TodoistWebhookPayload {
  try {
    const payload = JSON.parse(rawBody)

    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload must be an object')
    }

    return payload as TodoistWebhookPayload
  } catch {
    throw badRequestError('Webhook payload is not valid JSON')
  }
}

function extractEventName(payload: TodoistWebhookPayload): string {
  return typeof payload.event_name === 'string'
    ? payload.event_name
    : 'unknown'
}

function extractItemId(payload: TodoistWebhookPayload): string | null {
  return toStringId(payload.event_data?.id)
    ?? toStringId(payload.event_data?.item_id)
    ?? toStringId(payload.item_id)
}

function extractTodoistUserId(payload: TodoistWebhookPayload): string | null {
  return toStringId(payload.event_data?.user_id)
    ?? toStringId(payload.user_id)
    ?? toStringId(payload.initiator?.id)
    ?? toStringId(payload.initiator_id)
}

function buildEventKey(payload: TodoistWebhookPayload, fallbackSource: string) {
  const explicitEventId = toStringId(payload.event_id)

  if (explicitEventId) {
    return explicitEventId
  }

  const eventName = extractEventName(payload)
  const itemId = extractItemId(payload) ?? 'unknown_item'
  const userId = extractTodoistUserId(payload) ?? 'unknown_user'

  return `${eventName}:${userId}:${itemId}:${fallbackSource}`
}

function extractActivityDate(payload: TodoistWebhookPayload): string {
  if (typeof payload.triggered_at === 'string' && payload.triggered_at.length >= 10) {
    return payload.triggered_at.slice(0, 10)
  }
  return new Date().toISOString().slice(0, 10)
}

function isCompletionEvent(payload: TodoistWebhookPayload): boolean {
  const eventName = extractEventName(payload)

  if (eventName === 'item:completed' || eventName === 'task:completed') {
    return true
  }

  return payload.event_data?.checked === true
}

async function processSubtaskCompletion(
  tx: DatabaseClient,
  userId: string,
  subtaskTodoistItemId: string,
  parentTodoistItemId: string | null,
  eventKey: string
): Promise<{ pointsEarned: number }> {
  const [settings, subtaskRow] = await Promise.all([
    settingsRepository.findByUserIdInTransaction(tx, userId),
    tasksRepository.findTaskByTodoistItemIdInTransaction(tx, userId, subtaskTodoistItemId)
  ])

  if (!subtaskRow) {
    return { pointsEarned: 0 }
  }

  const subtaskPoints = calculateTaskPoints(rowToTaskMetadata(subtaskRow), settings)

  await ledgerRepository.createTransactionAndUpdateBalanceInTransactionIdempotent(tx, {
    userId,
    transactionType: 'earned',
    amount: subtaskPoints,
    description: `Completed subtask: ${subtaskRow.title}`,
    source: 'todoist_webhook_subtask_completion',
    relatedEntityType: 'subtask',
    relatedEntityId: subtaskTodoistItemId,
    idempotencyKey: `todoist_webhook:subtask_completion:${userId}:${subtaskTodoistItemId}:${eventKey}`,
    metadata: {
      eventKey,
      itemType: 'subtask',
      todoistItemId: subtaskTodoistItemId
    }
  })

  let totalPointsEarned = subtaskPoints

  if (!parentTodoistItemId) {
    return { pointsEarned: totalPointsEarned }
  }

  const [counts] = await tasksRepository.getSubtaskCountsInTransaction(tx, userId, [parentTodoistItemId])

  if (!counts || counts.subtaskCount === 0 || counts.completedSubtaskCount !== counts.subtaskCount) {
    return { pointsEarned: totalPointsEarned }
  }

  await itemMappingsRepository.markCompletionInTransaction(tx, userId, parentTodoistItemId, true)

  const parentRow = await tasksRepository.findTaskByTodoistItemIdInTransaction(tx, userId, parentTodoistItemId)

  if (!parentRow || !parentRow.completionBonusEnabled) {
    return { pointsEarned: totalPointsEarned }
  }

  const taskPoints = calculateTaskPoints(rowToTaskMetadata(parentRow), settings)
  const bonusAmount = calculateCompletionBonus(taskPoints, parentRow.completionBonusPercent)

  if (bonusAmount > 0) {
    await ledgerRepository.createTransactionAndUpdateBalanceInTransactionIdempotent(tx, {
      userId,
      transactionType: 'bonus',
      amount: bonusAmount,
      description: `Completed task bonus: ${parentRow.title}`,
      source: 'todoist_webhook_task_completion_bonus',
      relatedEntityType: 'task',
      relatedEntityId: parentTodoistItemId,
      idempotencyKey: `todoist_webhook:task_completion_bonus:${userId}:${parentTodoistItemId}`,
      metadata: {
        eventKey,
        itemType: 'task',
        todoistItemId: parentTodoistItemId,
        bonusPercent: parentRow.completionBonusPercent,
        basePoints: taskPoints
      }
    })
    totalPointsEarned += bonusAmount
  }

  return { pointsEarned: totalPointsEarned }
}

export const todoistWebhookService = {
  verifySignature(rawBody: string, signature: string | null) {
    if (!signature) {
      return false
    }

    const expectedSignature = createHmac('sha256', getWebhookSecret())
      .update(rawBody)
      .digest('base64')

    return safeCompare(expectedSignature, normalizeSignature(signature))
  },

  buildFallbackDeliveryKey(rawBody: string) {
    return createHash('sha256').update(rawBody).digest('hex')
  },

  async processCompletionWebhook(input: ProcessTodoistWebhookInput) {
    const payload = parsePayload(input.rawBody)
    const payloadFingerprint = createHash('sha256').update(input.rawBody).digest('hex')
    const eventKey = buildEventKey(payload, payloadFingerprint)

    logger.info('webhook_received', { deliveryKey: input.deliveryKey, eventKey })

    if (!isCompletionEvent(payload)) {
      const record = await webhookDeliveriesRepository.create({
        userId: null,
        deliveryKey: input.deliveryKey,
        eventKey,
        status: 'ignored_non_completion',
        payload: payload as Record<string, unknown>
      })

      logger.info('webhook_ignored', {
        deliveryKey: input.deliveryKey,
        eventKey,
        reason: 'non_completion',
        duplicated: record === null
      })

      return {
        received: true,
        duplicated: record === null,
        processed: false
      }
    }

    const todoistUserId = extractTodoistUserId(payload)
    const completedItemId = extractItemId(payload)

    if (!todoistUserId || !completedItemId) {
      const record = await webhookDeliveriesRepository.create({
        userId: null,
        deliveryKey: input.deliveryKey,
        eventKey,
        status: 'ignored_missing_fields',
        payload: payload as Record<string, unknown>
      })

      logger.warn('webhook_ignored', {
        deliveryKey: input.deliveryKey,
        eventKey,
        reason: 'missing_fields',
        duplicated: record === null
      })

      return {
        received: true,
        duplicated: record === null,
        processed: false
      }
    }

    const user = await usersRepository.findByTodoistUserId(todoistUserId)

    if (!user) {
      const record = await webhookDeliveriesRepository.create({
        userId: null,
        deliveryKey: input.deliveryKey,
        eventKey,
        status: 'ignored_unknown_user',
        payload: payload as Record<string, unknown>
      })

      logger.info('webhook_ignored', {
        deliveryKey: input.deliveryKey,
        eventKey,
        reason: 'unknown_user',
        todoistUserId,
        duplicated: record === null
      })

      return {
        received: true,
        duplicated: record === null,
        processed: false
      }
    }

    // Catch up any missed days before opening the main transaction so that
    // streak state is current before the current day is evaluated.
    await streakService.ensureEvaluatedThroughDate(user.id, yesterdayUtc())

    const db = getDb()

    return db.transaction(async (tx) => {
      const record = await webhookDeliveriesRepository.createInTransaction(tx as unknown as DatabaseClient, {
        userId: user.id,
        deliveryKey: input.deliveryKey,
        eventKey,
        status: 'processing',
        payload: payload as Record<string, unknown>
      })

      if (!record) {
        logger.info('webhook_duplicate', {
          deliveryKey: input.deliveryKey,
          eventKey,
          userId: user.id
        })
        return {
          received: true,
          duplicated: true,
          processed: false
        }
      }

      const mapping = await itemMappingsRepository.findByUserIdAndTodoistItemIdInTransaction(
        tx as unknown as DatabaseClient,
        user.id,
        completedItemId
      )

      if (!mapping || (mapping.itemType !== 'task' && mapping.itemType !== 'subtask')) {
        await webhookDeliveriesRepository.updateStatusByIdInTransaction(
          tx as unknown as DatabaseClient,
          record.id,
          'ignored_missing_mapping'
        )

        return {
          received: true,
          duplicated: false,
          processed: false
        }
      }

      await itemMappingsRepository.markCompletionInTransaction(
        tx as unknown as DatabaseClient,
        user.id,
        mapping.todoistItemId,
        true
      )

      const activityDate = extractActivityDate(payload)
      let pointsEarned = 0

      if (mapping.itemType === 'subtask') {
        const result = await processSubtaskCompletion(
          tx as unknown as DatabaseClient,
          user.id,
          mapping.todoistItemId,
          mapping.parentTodoistItemId,
          eventKey
        )
        pointsEarned = result.pointsEarned
      }

      // Update the per-day aggregate then evaluate streak for this date
      await streaksRepository.upsertHistoryIncrementAggregatesInTransaction(
        tx as unknown as DatabaseClient,
        user.id,
        activityDate,
        pointsEarned,
        mapping.itemType === 'subtask' ? 1 : 0
      )

      await streakService.evaluateDayInTransaction(
        tx as unknown as DatabaseClient,
        user.id,
        activityDate
      )

      await webhookDeliveriesRepository.updateStatusByIdInTransaction(
        tx as unknown as DatabaseClient,
        record.id,
        'processed'
      )

      logger.info('webhook_processed', {
        deliveryKey: input.deliveryKey,
        eventKey,
        userId: user.id,
        itemId: completedItemId,
        itemType: mapping.itemType,
        pointsEarned,
        activityDate
      })

      return {
        received: true,
        duplicated: false,
        processed: true
      }
    })
  }
}
