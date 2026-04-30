import { manualLedgerAdjustmentSchema } from '../../../shared/schemas'
import { pointsEngineService } from '../../services/points/pointsEngineService'
import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'
import { parseBodyWithSchema } from '../../utils/validation'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
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
