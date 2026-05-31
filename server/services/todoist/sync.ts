import { z } from 'zod'

import { forbiddenError, internalServerError, unauthorizedError } from '../../utils/api'

const TODOIST_PROJECTS_URL = 'https://api.todoist.com/api/v1/projects'
const TODOIST_TASKS_URL = 'https://api.todoist.com/api/v1/tasks'

const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    results: z.array(itemSchema),
    next_cursor: z.string().nullable().optional()
  })

const todoistProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable().optional()
}).passthrough()

const todoistDueSchema = z.object({
  date: z.string().optional(),
  datetime: z.string().nullable().optional()
}).passthrough()

const todoistTaskSchema = z.object({
  id: z.string(),
  content: z.string(),
  project_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  due: todoistDueSchema.nullable().optional(),
  checked: z.boolean().optional(),
  is_deleted: z.boolean().optional()
}).passthrough()

export type TodoistProject = z.infer<typeof todoistProjectSchema>
export type TodoistTask = z.infer<typeof todoistTaskSchema>

async function fetchPaginated<T>(
  url: string,
  schema: z.ZodType<T>,
  accessToken: string
): Promise<T[]> {
  const results: T[] = []
  let cursor: string | null | undefined = undefined

  while (true) {
    const requestUrl = new URL(url)
    if (cursor) {
      requestUrl.searchParams.set('cursor', cursor)
    }

    const response = await fetch(requestUrl.toString(), {
      headers: { authorization: `Bearer ${accessToken}` }
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw unauthorizedError('Todoist authorization failed', {
          status: response.status,
          statusText: response.statusText,
          url
        })
      }

      if (response.status === 403) {
        throw forbiddenError('Todoist access forbidden', {
          status: response.status,
          statusText: response.statusText,
          url
        })
      }

      throw internalServerError(`Todoist API request failed: ${url}`, {
        status: response.status,
        statusText: response.statusText
      })
    }

    const data = paginatedResponseSchema(schema).parse(await response.json())

    results.push(...data.results)

    if (!data.next_cursor) {
      break
    }

    cursor = data.next_cursor
  }

  return results
}

export async function fetchAllTodoistProjects(accessToken: string): Promise<TodoistProject[]> {
  return fetchPaginated(TODOIST_PROJECTS_URL, todoistProjectSchema, accessToken)
}

export async function fetchAllTodoistTasks(accessToken: string): Promise<TodoistTask[]> {
  const tasks = await fetchPaginated(TODOIST_TASKS_URL, todoistTaskSchema, accessToken)
  return tasks.filter(t => !t.is_deleted)
}
