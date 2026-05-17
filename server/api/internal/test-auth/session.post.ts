import { z } from 'zod'

import { defineApiHandler, notFoundError, success } from '../../../utils/api'
import { parseBodyWithSchema } from '../../../utils/validation'
import { usersRepository } from '../../../repositories/users'
import { setAppSession, toSessionUser } from '../../../utils/session'

const devSessionSchema = z.object({
  userId: z.string().uuid().optional(),
  todoistUserId: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  displayName: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional()
}).strict().refine(
  payload => Boolean(payload.userId || (payload.todoistUserId && payload.email)),
  {
    message: 'Provide userId or both todoistUserId and email',
    path: ['_root']
  }
)

function assertNonProduction() {
  if (process.env.NODE_ENV === 'production') {
    throw notFoundError()
  }
}

export default defineApiHandler(async (event) => {
  assertNonProduction()

  const payload = await parseBodyWithSchema(event, devSessionSchema)

  const user = payload.userId
    ? await usersRepository.findById(payload.userId)
    : await usersRepository.upsertByTodoistUserId({
        todoistUserId: payload.todoistUserId!,
        email: payload.email!,
        displayName: payload.displayName ?? 'Dev Session User',
        timezone: payload.timezone ?? 'UTC'
      })

  if (!user) {
    throw notFoundError('User not found')
  }

  setAppSession(event, user.id)

  return success({
    authenticated: true,
    user: toSessionUser(user),
    initialSyncCompleted: false
  })
})
