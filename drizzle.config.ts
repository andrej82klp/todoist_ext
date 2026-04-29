import 'dotenv/config'

import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@127.0.0.1:5432/todoist_ext'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl
  },
  strict: true,
  verbose: true
})
