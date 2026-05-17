import { manualLedgerAdjustmentSchema } from '../../../shared/schemas'
import { pointsEngineService } from '../../services/points/pointsEngineService'
import { defineApiHandler, success, tooManyRequestsError } from '../../utils/api'
import { checkRateLimit, createRateLimiter } from '../../utils/rate-limit'
import { requireCurrentUser } from '../../utils/session'
import { parseBodyWithSchema } from '../../utils/validation'

// 20 manual adjustments per user per minute.
const adjustmentsLimiter = createRateLimiter({ windowMs: 60_000, max: 20 })

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)

  if (!checkRateLimit(adjustmentsLimiter, event, 'per-user', user.id)) {
    throw tooManyRequestsError()
  }

  const body = await parseBodyWithSchema(event, manualLedgerAdjustmentSchema)

  const { transaction, pointsSummary } = await pointsEngineService.applyManualAdjustment({
    userId: user.id,
    amount: body.amount,
    reason: body.reason,
    description: body.description,
    relatedEntityType: body.relatedEntityType,
    relatedEntityId: body.relatedEntityId,
    metadata: body.metadata
  })

  return success({
    success: true,
    transaction,
    pointsSummary
  })
})
