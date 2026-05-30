import type { EnrichedTask, TaskListProjectOption } from '../../../shared/types'
import { taskListQuerySchema } from '../../../shared/schemas'
import type { TASK_SORT_FIELDS } from '../../../shared/constants/api'
import { collection, defineApiHandler } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'
import { parseQueryWithSchema } from '../../utils/validation'
import { tasksRepository } from '../../repositories/tasks'
import { taskAssemblyService } from '../../services/tasks/taskAssemblyService'

type TaskSortField = typeof TASK_SORT_FIELDS[number]

function sortTasks(tasks: EnrichedTask[], sortBy: TaskSortField, sortOrder: 'asc' | 'desc'): EnrichedTask[] {
  const priorityOrder = { low: 1, medium: 2, high: 3 }
  const dir = sortOrder === 'asc' ? 1 : -1

  return [...tasks].sort((a, b) => {
    let cmp = 0
    switch (sortBy) {
      case 'task':
        cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
        break
      case 'priority':
        cmp = priorityOrder[a.metadata.priority] - priorityOrder[b.metadata.priority]
        break
      case 'difficulty':
        cmp = a.metadata.difficulty - b.metadata.difficulty
        break
      case 'estimatedPoints':
        cmp = a.estimatedPoints - b.estimatedPoints
        break
      case 'deadline': {
        const aTime = a.deadline ? new Date(a.deadline).getTime() : Infinity
        const bTime = b.deadline ? new Date(b.deadline).getTime() : Infinity
        cmp = aTime - bTime
        break
      }
    }
    return cmp * dir
  })
}

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const query = parseQueryWithSchema(event, taskListQuerySchema)

  const rows = await tasksRepository.findTasksWithMeta(user.id, {
    projectTodoistId: query.projectId,
    includeCompleted: query.includeCompleted
  })

  let tasks = await taskAssemblyService.buildEnrichedTaskList(user.id, rows)

  if (query.sortBy) {
    tasks = sortTasks(tasks, query.sortBy, query.sortOrder ?? 'asc')
  }

  const availableProjects: TaskListProjectOption[] = tasks
    .reduce((acc, task) => {
      if (task.projectId && task.projectName && !acc.some(project => project.id === task.projectId)) {
        acc.push({
          id: task.projectId,
          name: task.projectName
        })
      }
      return acc
    }, [] as TaskListProjectOption[])
    .sort((a, b) => a.name.localeCompare(b.name))

  const total = tasks.length
  const start = (query.page - 1) * query.pageSize
  const page = tasks.slice(start, start + query.pageSize)

  return collection(page, {
    page: query.page,
    pageSize: query.pageSize,
    total,
    availableProjects
  })
})
