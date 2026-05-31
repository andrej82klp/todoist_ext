import { getRouterParam } from 'h3'

import { taskGroupMetadataSchema } from '../../../../shared/schemas'
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

  const body = await parseBodyWithSchema(event, taskGroupMetadataSchema)

  await tasksRepository.upsertTaskGroupMetadata(user.id, taskId, {
    badge: body.badge,
    completionBonusPoints: body.completionBonusPoints
  })

  return success({
    taskId,
    metadata: {
      badge: body.badge,
      completionBonusPoints: body.completionBonusPoints
    }
  })
})
