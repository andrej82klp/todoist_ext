import { getHeader, readRawBody } from 'h3'

import { badRequestError, defineApiHandler, success, unauthorizedError } from '../../utils/api'
import { todoistWebhookService } from '../../services/todoist/webhookService'

export default defineApiHandler(async (event) => {
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
