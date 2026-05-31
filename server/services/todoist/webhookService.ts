import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { DatabaseClient } from '../../db/client'
import { getDb } from '../../db/client'
import { itemMappingsRepository } from '../../repositories/item-mappings'
import { ledgerRepository } from '../../repositories/ledger'
import { settingsRepository } from '../../repositories/settings'
import { streaksRepository } from '../../repositories/streaks'
import type { SubtaskWithMetaRow } from '../../repositories/tasks'
import { tasksRepository } from '../../repositories/tasks'
import { usersRepository } from '../../repositories/users'
import { webhookDeliveriesRepository } from '../../repositories/webhook-deliveries'
import { badRequestError } from '../../utils/api'
import { logger } from '../../utils/logger'
import {
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

/**
 * Resolves the shared secret used to validate Todoist webhook signatures.
 *
 * Behavior:
 * - Uses `TODOIST_WEBHOOK_SECRET` when provided.
 * - Falls back to `TODOIST_CLIENT_SECRET` for backwards compatibility.
 * - Throws a bad request error when neither secret exists.
 *
 * Use this helper wherever signature verification is performed so all
 * webhook entry points use the same secret resolution policy.
 */
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

/**
 * Compares two signature strings in constant time.
 *
 * This guards against timing attacks when validating untrusted signatures.
 * Returns `false` immediately for mismatched lengths because
 * `timingSafeEqual` requires equal-sized buffers.
 */
function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * Normalizes an inbound signature value from HTTP headers.
 *
 * Some providers prefix signatures with `sha256=` while others return only
 * the digest. This helper accepts both formats and returns the digest-only
 * representation expected by internal comparison logic.
 */
function normalizeSignature(signature: string) {
  const trimmed = signature.trim()

  if (trimmed.startsWith('sha256=')) {
    return trimmed.slice('sha256='.length)
  }

  return trimmed
}

/**
 * Converts supported identifier values into canonical string IDs.
 *
 * Accepts non-empty strings and finite numbers. Returns `null` for all other
 * values so callers can treat missing or invalid identifiers uniformly.
 */
function toStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

/**
 * Projects a subtask row into the minimal metadata expected by the points engine.
 *
 * Keep this adapter in sync with `calculateTaskPoints` inputs so task-scoring
 * logic remains decoupled from repository row shapes.
 */
function rowToSubtaskMetadata(row: SubtaskWithMetaRow) {
  return {
    priority: row.priority,
    difficulty: row.difficulty,
    timeEstimateMinutes: row.timeEstimateMinutes
  }
}

/**
 * Parses and validates the raw webhook JSON body.
 *
 * Throws a bad request error when the payload is malformed or not an object.
 * This gives callers a normalized failure mode for invalid webhook content.
 */
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

/**
 * Reads the event name from a webhook payload with a safe fallback.
 *
 * Returns `unknown` when the field is absent to avoid propagating `undefined`
 * into idempotency keys and observability fields.
 */
function extractEventName(payload: TodoistWebhookPayload): string {
  return typeof payload.event_name === 'string'
    ? payload.event_name
    : 'unknown'
}

/**
 * Extracts the Todoist item identifier from supported payload variants.
 *
 * Todoist webhook payloads can place the item ID in different locations
 * depending on event type. This helper checks known locations in priority
 * order and returns `null` if no usable value is found.
 */
function extractItemId(payload: TodoistWebhookPayload): string | null {
  return toStringId(payload.event_data?.id)
    ?? toStringId(payload.event_data?.item_id)
    ?? toStringId(payload.item_id)
}

/**
 * Extracts the Todoist user identifier from supported payload variants.
 *
 * User IDs can appear on event data, top-level fields, or initiator fields.
 * This function centralizes that lookup so user resolution behavior is
 * consistent across all webhook processing paths.
 */
function extractTodoistUserId(payload: TodoistWebhookPayload): string | null {
  return toStringId(payload.event_data?.user_id)
    ?? toStringId(payload.user_id)
    ?? toStringId(payload.initiator?.id)
    ?? toStringId(payload.initiator_id)
}

/**
 * Builds a stable idempotency key seed for a webhook event.
 *
 * Prefers Todoist's explicit `event_id` when available. Otherwise constructs a
 * deterministic composite key from event name, user ID, item ID, and a caller
 * supplied fallback source (typically a payload hash). This ensures retries and
 * duplicate deliveries map to the same event identity.
 */
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

/**
 * Chooses the activity date used for streak accounting.
 *
 * Uses the date portion of `triggered_at` when present; otherwise falls back to
 * the current UTC date. Returned format is `YYYY-MM-DD`.
 */
function extractActivityDate(payload: TodoistWebhookPayload): string {
  if (typeof payload.triggered_at === 'string' && payload.triggered_at.length >= 10) {
    return payload.triggered_at.slice(0, 10)
  }
  return new Date().toISOString().slice(0, 10)
}

/**
 * Determines whether a webhook should be treated as a completion event.
 *
 * Supports explicit completion event names and the legacy `checked: true`
 * signal for compatibility with different Todoist payload versions.
 */
function isCompletionEvent(payload: TodoistWebhookPayload): boolean {
  const eventName = extractEventName(payload)

  if (eventName === 'item:completed' || eventName === 'task:completed') {
    return true
  }

  return payload.event_data?.checked === true
}

/**
 * Handles points and bonus processing for a completed subtask.
 *
 * Workflow:
 * - Loads user settings and subtask metadata.
 * - Awards subtask points idempotently in the ledger.
 * - If all sibling subtasks are complete, marks parent as complete.
 * - If parent has a fixed completionBonusPoints > 0, awards it idempotently.
 *
 * This helper must execute inside an existing transaction to keep task mapping,
 * ledger writes, and completion state changes atomic.
 */
async function processSubtaskCompletion(
  tx: DatabaseClient,
  userId: string,
  subtaskTodoistItemId: string,
  parentTodoistItemId: string | null,
  eventKey: string
): Promise<{ pointsEarned: number }> {
  let subtaskRow: SubtaskWithMetaRow | null

  if (parentTodoistItemId) {
    // Subtask has a known parent: load all siblings so we can check all-done later.
    const [settings, subtaskRows] = await Promise.all([
      settingsRepository.findByUserIdInTransaction(tx, userId),
      tasksRepository.getSubtasksWithMetaForTaskInTransaction(tx, userId, parentTodoistItemId)
    ])
    subtaskRow = subtaskRows.find(r => r.todoistItemId === subtaskTodoistItemId) ?? null
    if (!subtaskRow) {
      return { pointsEarned: 0 }
    }

    const subtaskPoints = calculateTaskPoints(rowToSubtaskMetadata(subtaskRow), settings)

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

    const [counts] = await tasksRepository.getSubtaskCountsInTransaction(tx, userId, [parentTodoistItemId])

    if (!counts || counts.subtaskCount === 0 || counts.completedSubtaskCount !== counts.subtaskCount) {
      return { pointsEarned: totalPointsEarned }
    }

    await itemMappingsRepository.markCompletionInTransaction(tx, userId, parentTodoistItemId, true)

    const parentRow = await tasksRepository.findTaskByTodoistItemIdInTransaction(tx, userId, parentTodoistItemId)

    if (!parentRow || parentRow.completionBonusPoints <= 0) {
      return { pointsEarned: totalPointsEarned }
    }

    const bonusAmount = parentRow.completionBonusPoints

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
        fixedBonusPoints: bonusAmount
      }
    })
    totalPointsEarned += bonusAmount

    return { pointsEarned: totalPointsEarned }
  }

  // Orphan subtask (no parent): look up by its own ID; no parent bonus possible.
  const [settings, orphanSubtaskRow] = await Promise.all([
    settingsRepository.findByUserIdInTransaction(tx, userId),
    tasksRepository.findSubtaskWithMetaByTodoistItemIdInTransaction(tx, userId, subtaskTodoistItemId)
  ])
  subtaskRow = orphanSubtaskRow

  if (!subtaskRow) {
    return { pointsEarned: 0 }
  }

  const orphanPoints = calculateTaskPoints(rowToSubtaskMetadata(subtaskRow), settings)

  await ledgerRepository.createTransactionAndUpdateBalanceInTransactionIdempotent(tx, {
    userId,
    transactionType: 'earned',
    amount: orphanPoints,
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

  return { pointsEarned: orphanPoints }
}

export const todoistWebhookService = {
  /**
   * Verifies that a webhook signature matches the raw request body.
   *
   * Call this before processing payload data. Returns `false` when the
   * signature header is missing or invalid, allowing callers to reject the
   * request with an authorization/signature error.
   */
  verifySignature(rawBody: string, signature: string | null) {
    if (!signature) {
      return false
    }

    const expectedSignature = createHmac('sha256', getWebhookSecret())
      .update(rawBody)
      .digest('base64')

    return safeCompare(expectedSignature, normalizeSignature(signature))
  },

  /**
   * Generates a deterministic fallback delivery key from raw payload content.
   *
   * Useful when upstream delivery IDs are unavailable. The hash should be used
   * only as a fallback deduplication key, not as a security primitive.
   */
  buildFallbackDeliveryKey(rawBody: string) {
    return createHash('sha256').update(rawBody).digest('hex')
  },

  /**
   * Main webhook processing pipeline for Todoist completion events.
   *
   * Responsibilities:
   * - Parse payload and derive deterministic event identity.
   * - Ignore non-completion or malformed events while recording delivery status.
   * - Resolve local user from Todoist user ID.
   * - Pre-catch-up streak history through yesterday.
   * - Process mapped task/subtask completion inside a DB transaction.
   * - Award points/bonuses (subtasks), update streak aggregates, and mark
   *   webhook delivery state for idempotent retries.
   *
   * This method is safe to call multiple times for the same delivery because
   * webhook delivery records and idempotent ledger writes prevent double-credit.
   */
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
