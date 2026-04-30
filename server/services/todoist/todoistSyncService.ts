import type { UpsertItemMappingInput } from '../../repositories/item-mappings'
import { itemMappingsRepository } from '../../repositories/item-mappings'
import { fetchAllTodoistProjects, fetchAllTodoistTasks } from './sync'

function parseDueDate(due: { date?: string, datetime?: string | null } | null | undefined): Date | null {
  if (!due) return null
  const raw = due.datetime ?? due.date
  if (!raw) return null
  const parsed = new Date(raw)
  return isNaN(parsed.getTime()) ? null : parsed
}

export const todoistSyncService = {
  async runInitialSync(userId: string, accessToken: string): Promise<{ projectCount: number, taskCount: number, subtaskCount: number }> {
    const [projects, tasks] = await Promise.all([
      fetchAllTodoistProjects(accessToken),
      fetchAllTodoistTasks(accessToken)
    ])

    const projectItems: UpsertItemMappingInput[] = projects.map(project => ({
      todoistItemId: project.id,
      itemType: 'project' as const,
      parentTodoistItemId: project.parent_id ?? null,
      projectTodoistId: null,
      title: project.name,
      dueAt: null,
      isCompleted: false
    }))

    const taskItems: UpsertItemMappingInput[] = tasks.map(task => ({
      todoistItemId: task.id,
      itemType: task.parent_id ? ('subtask' as const) : ('task' as const),
      parentTodoistItemId: task.parent_id ?? null,
      projectTodoistId: task.project_id ?? null,
      title: task.content,
      dueAt: parseDueDate(task.due),
      isCompleted: task.checked ?? false
    }))

    const allItems = [...projectItems, ...taskItems]
    await itemMappingsRepository.upsertMany(userId, allItems)

    const subtaskCount = taskItems.filter(t => t.itemType === 'subtask').length
    const rootTaskCount = taskItems.filter(t => t.itemType === 'task').length

    return {
      projectCount: projectItems.length,
      taskCount: rootTaskCount,
      subtaskCount
    }
  }
}
