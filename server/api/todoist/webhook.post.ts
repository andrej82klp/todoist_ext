import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { getHeader, readRawBody } from 'h3'

import { badRequestError, defineApiHandler, success, tooManyRequestsError, unauthorizedError } from '../../utils/api'
import { checkRateLimit, createRateLimiter } from '../../utils/rate-limit'
import { todoistWebhookService } from '../../services/todoist/webhookService'
import { logger, redactForLog } from '../../utils/logger'

// 100 webhook deliveries per IP per minute — generous for Todoist's CDN egress
// but still guards against replay flooding from a single origin.
const webhookLimiter = createRateLimiter({ windowMs: 60_000, max: 100 })
const webhookLogPath = resolve(process.cwd(), 'logs', 'todoist-webhook.log')

function normalizeHeaders(headers: Record<string, string | string[] | undefined>) {
  const normalized: Record<string, string | string[]> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'undefined') {
      continue
    }

    normalized[key] = value
  }

  return normalized
}

function parsePayloadSafely(rawBody: string) {
  try {
    return JSON.parse(rawBody)
  } catch {
    return {
      rawBody
    }
  }
}

function toErrorLog(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  }

  return {
    message: typeof error === 'string' ? error : 'Unknown error',
    detail: error
  }
}

async function initializeWebhookLogFile() {
  await mkdir(dirname(webhookLogPath), { recursive: true })
  await appendFile(webhookLogPath, '', 'utf8')
}

void initializeWebhookLogFile().catch((error) => {
  logger.error('webhook_log_init_failed', {
    error: toErrorLog(error),
    path: webhookLogPath
  })
})

async function writeWebhookLog(entry: Record<string, unknown>) {
  try {
    const line = JSON.stringify(redactForLog(entry))
    await appendFile(webhookLogPath, `${line}\n`, 'utf8')
  } catch (error) {
    logger.error('webhook_log_write_failed', {
      error: toErrorLog(error),
      path: webhookLogPath
    })
  }
}

function queueWebhookLog(entry: Record<string, unknown>) {
  void writeWebhookLog(entry)
}

export default defineApiHandler(async (event) => {
  const requestTs = new Date().toISOString()
  const requestHeaders = normalizeHeaders(event.node.req.headers)
  const requestMethod = event.method
  const requestUrl = event.path
  let rawBody = ''
  let deliveryKey: string | null = null

  try {
    if (!checkRateLimit(webhookLimiter, event, 'per-ip')) {
      throw tooManyRequestsError()
    }

    rawBody = (await readRawBody(event, 'utf8')) ?? ''

    queueWebhookLog({
      timestamp: requestTs,
      type: 'incoming_request',
      method: requestMethod,
      url: requestUrl,
      headers: requestHeaders,
      payload: parsePayloadSafely(rawBody)
    })

    if (!rawBody) {
      throw badRequestError('Webhook payload is required')
    }

    const signature = getHeader(event, 'x-todoist-hmac-sha256')?.trim() ?? null

    if (!todoistWebhookService.verifySignature(rawBody, signature)) {
      throw unauthorizedError('Invalid webhook signature')
    }

    const headerDeliveryKey = getHeader(event, 'x-todoist-delivery-id')?.trim() ?? null
    deliveryKey = headerDeliveryKey || todoistWebhookService.buildFallbackDeliveryKey(rawBody)

    await todoistWebhookService.processCompletionWebhook({
      rawBody,
      deliveryKey
    })

    queueWebhookLog({
      timestamp: new Date().toISOString(),
      type: 'processed',
      method: requestMethod,
      url: requestUrl,
      deliveryKey,
      status: 'success'
    })

    return success({
      received: true
    })
  } catch (error) {
    queueWebhookLog({
      timestamp: new Date().toISOString(),
      type: 'processing_error',
      method: requestMethod,
      url: requestUrl,
      headers: requestHeaders,
      deliveryKey,
      payload: rawBody ? parsePayloadSafely(rawBody) : null,
      error: toErrorLog(error)
    })

    throw error
  }
})
