import { batchMetadataUpdateSchema } from '../../../../shared/schemas'
import { defineApiHandler, success } from '../../../utils/api'
import { requireCurrentUser } from '../../../utils/session'
import { parseBodyWithSchema } from '../../../utils/validation'
import { tasksRepository } from '../../../repositories/tasks'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const body = await parseBodyWithSchema(event, batchMetadataUpdateSchema)

  const results = await Promise.allSettled(
    body.items.map(async (item) => {
      const task = await tasksRepository.findTaskById(user.id, item.taskId)
      if (!task) return { taskId: item.taskId, success: false }

      await tasksRepository.upsertTaskMetadata(user.id, item.taskId, {
        priority: item.priority,
        difficulty: item.difficulty,
        timeEstimateMinutes: item.timeEstimateMinutes,
        completionBonusEnabled: item.completionBonusEnabled,
        completionBonusPercent: item.completionBonusPercent,
        badge: item.badge,
        customPointOverride: item.customPointOverride
      })

      return { taskId: item.taskId, success: true }
    })
  )

  const items = results.map(r =>
    r.status === 'fulfilled' ? r.value : { taskId: 'unknown', success: false }
  )

  return success({
    updated: items.filter(i => i.success).length,
    items
  })
})
