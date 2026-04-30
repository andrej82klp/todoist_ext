import type { H3Event } from 'h3'
import { getQuery, readBody } from 'h3'
import type { ZodType } from 'zod'

export async function parseBodyWithSchema<TSchema extends ZodType>(event: H3Event, schema: TSchema) {
  const body = await readBody(event)
  return schema.parse(body)
}

export function parseQueryWithSchema<TSchema extends ZodType>(event: H3Event, schema: TSchema) {
  const query = getQuery(event)
  return schema.parse(query)
}
