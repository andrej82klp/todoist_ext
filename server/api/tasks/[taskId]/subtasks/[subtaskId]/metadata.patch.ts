import { getRouterParam } from 'h3'

import { subtaskMetadataSchema } from '../../../../../../shared/schemas'
import { defineApiHandler, notFoundError, success, tooManyRequestsError } from '../../../../../utils/api'
import { checkRateLimit, createRateLimiter } from '../../../../../utils/rate-limit'
import { requireCurrentUser } from '../../../../../utils/session'
import { parseBodyWithSchema } from '../../../../../utils/validation'
import { tasksRepository } from '../../../../../repositories/tasks'

// 30 subtask metadata writes per user per minute.
const metadataLimiter = createRateLimiter({ windowMs: 60_000, max: 30 })

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)

  if (!checkRateLimit(metadataLimiter, event, 'per-user', user.id)) {
    throw tooManyRequestsError()
  }

  const taskId = getRouterParam(event, 'taskId')
  const subtaskId = getRouterParam(event, 'subtaskId')

  if (!taskId || !subtaskId) {
    throw notFoundError('Task or subtask not found')
  }

  const parentTask = await tasksRepository.findTaskById(user.id, taskId)
  if (!parentTask) {
    throw notFoundError('Task not found')
  }

  const subtask = await tasksRepository.findSubtaskByIdForParent(user.id, subtaskId, taskId)
  if (!subtask) {
    throw notFoundError('Subtask not found')
  }

  const body = await parseBodyWithSchema(event, subtaskMetadataSchema)

  await tasksRepository.upsertSubtaskMetadata(user.id, subtaskId, {
    priority: body.priority,
    difficulty: body.difficulty,
    timeEstimateMinutes: body.timeEstimateMinutes
  })

  return success({
    taskId,
    subtaskId,
    metadata: {
      priority: body.priority,
      difficulty: body.difficulty,
      timeEstimateMinutes: body.timeEstimateMinutes
    }
  })
})
