import { eq } from 'drizzle-orm'

import { getDb } from '../db/client'
import { users, type NewUser } from '../db/schema'

export interface CreateUserInput {
  email: string
  todoistUserId: string
  displayName?: string | null
  avatarUrl?: string | null
  timezone?: string | null
}

function buildUserValues(input: CreateUserInput): NewUser {
  return {
    email: input.email,
    todoistUserId: input.todoistUserId,
    displayName: input.displayName ?? null,
    avatarUrl: input.avatarUrl ?? null,
    timezone: input.timezone ?? null
  }
}

export const usersRepository = {
  async create(input: CreateUserInput) {
    const db = getDb()
    const [user] = await db.insert(users).values(buildUserValues(input)).returning()

    return user
  },

  async upsertByTodoistUserId(input: CreateUserInput) {
    const db = getDb()
    const [user] = await db.insert(users)
      .values(buildUserValues(input))
      .onConflictDoUpdate({
        target: users.todoistUserId,
        set: {
          email: input.email,
          displayName: input.displayName ?? null,
          avatarUrl: input.avatarUrl ?? null,
          timezone: input.timezone ?? null,
          updatedAt: new Date()
        }
      })
      .returning()

    return user
  },

  async findById(id: string) {
    const db = getDb()
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)

    return user ?? null
  },

  async findByTodoistUserId(todoistUserId: string) {
    const db = getDb()
    const [user] = await db.select().from(users).where(eq(users.todoistUserId, todoistUserId)).limit(1)

    return user ?? null
  }
}
