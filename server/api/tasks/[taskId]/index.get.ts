import { getRouterParam } from 'h3'

import { defineApiHandler, notFoundError, success } from '../../../utils/api'
import { requireCurrentUser } from '../../../utils/session'
import { tasksRepository } from '../../../repositories/tasks'
import { taskAssemblyService } from '../../../services/tasks/taskAssemblyService'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const taskId = getRouterParam(event, 'taskId')

  if (!taskId) {
    throw notFoundError('Task not found')
  }

  const row = await tasksRepository.findTaskById(user.id, taskId)

  if (!row) {
    throw notFoundError('Task not found')
  }

  const detail = await taskAssemblyService.buildEnrichedTaskDetail(user.id, row)

  return success(detail)
})
