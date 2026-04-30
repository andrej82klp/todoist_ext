import { and, eq } from 'drizzle-orm'

import { getDb } from '../db/client'
import { oauthAccounts } from '../db/schema'
import { encryptSecret } from '../utils/secrets'

export interface UpsertTodoistOauthAccountInput {
  userId: string
  providerUserId: string
  accessToken: string
  refreshToken?: string | null
  scope?: string | null
  tokenType?: string | null
  tokenExpiresAt?: Date | null
}

export const oauthAccountsRepository = {
  async upsertTodoistAccount(input: UpsertTodoistOauthAccountInput) {
    const db = getDb()

    const encryptedAccessToken = encryptSecret(input.accessToken)
    const encryptedRefreshToken = input.refreshToken ? encryptSecret(input.refreshToken) : null

    const [record] = await db.insert(oauthAccounts)
      .values({
        userId: input.userId,
        provider: 'todoist',
        providerUserId: input.providerUserId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        scope: input.scope ?? null,
        tokenType: input.tokenType ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null
      })
      .onConflictDoUpdate({
        target: [oauthAccounts.userId, oauthAccounts.provider],
        set: {
          providerUserId: input.providerUserId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          scope: input.scope ?? null,
          tokenType: input.tokenType ?? null,
          tokenExpiresAt: input.tokenExpiresAt ?? null,
          updatedAt: new Date()
        }
      })
      .returning()

    return record
  },

  async findTodoistAccountByUserId(userId: string) {
    const db = getDb()
    const [record] = await db.select()
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, 'todoist')))
      .limit(1)

    return record ?? null
  }
}
