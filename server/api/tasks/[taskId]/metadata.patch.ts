import { getRouterParam } from 'h3'

import { taskMetadataSchema } from '../../../../shared/schemas'
import { defineApiHandler, notFoundError, success } from '../../../utils/api'
import { requireCurrentUser } from '../../../utils/session'
import { parseBodyWithSchema } from '../../../utils/validation'
import { tasksRepository } from '../../../repositories/tasks'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const taskId = getRouterParam(event, 'taskId')

  if (!taskId) {
    throw notFoundError('Task not found')
  }

  const task = await tasksRepository.findTaskById(user.id, taskId)

  if (!task) {
    throw notFoundError('Task not found')
  }

  const body = await parseBodyWithSchema(event, taskMetadataSchema)

  await tasksRepository.upsertTaskMetadata(user.id, taskId, {
    priority: body.priority,
    difficulty: body.difficulty,
    timeEstimateMinutes: body.timeEstimateMinutes,
    completionBonusEnabled: body.completionBonusEnabled,
    completionBonusPercent: body.completionBonusPercent,
    badge: body.badge,
    customPointOverride: body.customPointOverride
  })

  return success({
    taskId,
    metadata: {
      priority: body.priority,
      difficulty: body.difficulty,
      timeEstimateMinutes: body.timeEstimateMinutes,
      completionBonusEnabled: body.completionBonusEnabled,
      completionBonusPercent: body.completionBonusPercent,
      badge: body.badge,
      customPointOverride: body.customPointOverride
    }
  })
})
