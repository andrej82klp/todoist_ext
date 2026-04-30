import { z } from 'zod'

import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PRIORITY_LEVELS,
  SORT_ORDERS,
  TASK_SORT_FIELDS
} from '../constants/api'

const stringToNullableNumber = (value: unknown) => {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  return value
}

const stringToNullableTrimmed = (value: unknown) => {
  if (typeof value !== 'string') {
    return value
  }

  const trimmedValue = value.trim()
  return trimmedValue.length === 0 ? null : trimmedValue
}

const stringToBoolean = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()

    if (normalizedValue === 'true') {
      return true
    }

    if (normalizedValue === 'false') {
      return false
    }
  }

  return value
}

export const priorityLevelSchema = z.enum(PRIORITY_LEVELS)

export const sortOrderSchema = z.enum(SORT_ORDERS)

export const taskSortBySchema = z.enum(TASK_SORT_FIELDS)

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
}).strict()

export const taskListQuerySchema = paginationQuerySchema.extend({
  sortBy: taskSortBySchema.optional(),
  sortOrder: sortOrderSchema.optional(),
  projectId: z.string().trim().min(1).optional(),
  includeCompleted: z.preprocess(stringToBoolean, z.boolean().default(false))
}).strict()

export const nullableIntegerSchema = z.preprocess(
  stringToNullableNumber,
  z.number().int().nonnegative().nullable()
)

export const nullableTrimmedStringSchema = z.preprocess(
  stringToNullableTrimmed,
  z.string().trim().min(1).nullable()
)
