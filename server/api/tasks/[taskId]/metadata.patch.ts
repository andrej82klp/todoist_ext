import { getRouterParam } from 'h3'

import { taskMetadataSchema } from '../../../../shared/schemas'
import { defineApiHandler, notFoundError, success, tooManyRequestsError } from '../../../utils/api'
import { checkRateLimit, createRateLimiter } from '../../../utils/rate-limit'
import { requireCurrentUser } from '../../../utils/session'
import { parseBodyWithSchema } from '../../../utils/validation'
import { tasksRepository } from '../../../repositories/tasks'

// 30 single-task metadata writes per user per minute.
const metadataLimiter = createRateLimiter({ windowMs: 60_000, max: 30 })

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)

  if (!checkRateLimit(metadataLimiter, event, 'per-user', user.id)) {
    throw tooManyRequestsError()
  }

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
