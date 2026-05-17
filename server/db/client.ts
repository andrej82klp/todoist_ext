import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import * as schema from './schema'

let sqlClient: postgres.Sql | undefined

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to connect to Postgres')
  }

  return databaseUrl
}

export function getSqlClient() {
  if (!sqlClient) {
    sqlClient = postgres(getDatabaseUrl(), {
      max: 1,
      prepare: false,
      idle_timeout: 20
    })
  }

  return sqlClient
}

export function getDb() {
  return drizzle(getSqlClient(), { schema })
}

export async function closeDbConnection() {
  if (!sqlClient) {
    return
  }

  await sqlClient.end({ timeout: 5 })
  sqlClient = undefined
}

export type DatabaseClient = ReturnType<typeof getDb>
