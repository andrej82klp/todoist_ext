import { getHeader, readRawBody } from 'h3'

import { badRequestError, defineApiHandler, success, tooManyRequestsError, unauthorizedError } from '../../utils/api'
import { checkRateLimit, createRateLimiter } from '../../utils/rate-limit'
import { todoistWebhookService } from '../../services/todoist/webhookService'

// 100 webhook deliveries per IP per minute — generous for Todoist's CDN egress
// but still guards against replay flooding from a single origin.
const webhookLimiter = createRateLimiter({ windowMs: 60_000, max: 100 })

export default defineApiHandler(async (event) => {
  if (!checkRateLimit(webhookLimiter, event, 'per-ip')) {
    throw tooManyRequestsError()
  }

  const rawBody = await readRawBody(event, 'utf8')

  if (!rawBody) {
    throw badRequestError('Webhook payload is required')
  }

  const signature = getHeader(event, 'x-todoist-hmac-sha256')?.trim() ?? null

  if (!todoistWebhookService.verifySignature(rawBody, signature)) {
    throw unauthorizedError('Invalid webhook signature')
  }

  const headerDeliveryKey = getHeader(event, 'x-todoist-delivery-id')?.trim() ?? null
  const deliveryKey = headerDeliveryKey || todoistWebhookService.buildFallbackDeliveryKey(rawBody)

  await todoistWebhookService.processCompletionWebhook({
    rawBody,
    deliveryKey
  })

  return success({
    received: true
  })
})
