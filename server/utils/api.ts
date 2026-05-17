import type { EventHandler, H3Event } from 'h3'
import { defineEventHandler, setResponseStatus } from 'h3'
import { ZodError } from 'zod'

import { API_ERROR_MESSAGE, API_ERROR_STATUS } from '../../shared/constants/api'
import { logger } from './logger'
import type {
  ApiActionResponse,
  ApiCollectionResponse,
  ApiErrorCode,
  ApiErrorResponse,
  ApiSuccessResponse,
  CollectionMeta,
  ValidationErrorDetails
} from '../../shared/types'

type ApiErrorDetails = Record<string, unknown> | ValidationErrorDetails | undefined

type ApiHandler<T> = (event: H3Event) => Promise<T> | T

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR'
}

export class ApiHttpError extends Error {
  statusCode: number
  code: ApiErrorCode
  details?: ApiErrorDetails

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: ApiErrorDetails) {
    super(message)
    this.name = 'ApiHttpError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function success<T>(data: T): ApiSuccessResponse<T> {
  return { data }
}

export function collection<T, M extends CollectionMeta>(data: T[], meta: M): ApiCollectionResponse<T, M> {
  return { data, meta }
}

export function action(isSuccessful: boolean, message: string): ApiActionResponse {
  return {
    data: {
      success: isSuccessful,
      message
    }
  }
}

export function apiError(code: ApiErrorCode, message: string, details?: ApiErrorDetails): ApiErrorResponse {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } }
}

export function badRequestError(message: string = API_ERROR_MESSAGE.BAD_REQUEST, details?: ApiErrorDetails) {
  return new ApiHttpError(API_ERROR_STATUS.BAD_REQUEST, 'BAD_REQUEST', message, details)
}

export function unauthorizedError(message: string = API_ERROR_MESSAGE.UNAUTHORIZED, details?: ApiErrorDetails) {
  return new ApiHttpError(API_ERROR_STATUS.UNAUTHORIZED, 'UNAUTHORIZED', message, details)
}

export function forbiddenError(message: string = API_ERROR_MESSAGE.FORBIDDEN, details?: ApiErrorDetails) {
  return new ApiHttpError(API_ERROR_STATUS.FORBIDDEN, 'FORBIDDEN', message, details)
}

export function notFoundError(message: string = API_ERROR_MESSAGE.NOT_FOUND, details?: ApiErrorDetails) {
  return new ApiHttpError(API_ERROR_STATUS.NOT_FOUND, 'NOT_FOUND', message, details)
}

export function conflictError(message: string = API_ERROR_MESSAGE.CONFLICT, details?: ApiErrorDetails) {
  return new ApiHttpError(API_ERROR_STATUS.CONFLICT, 'CONFLICT', message, details)
}

export function validationError(details: ValidationErrorDetails, message: string = API_ERROR_MESSAGE.VALIDATION_ERROR) {
  return new ApiHttpError(API_ERROR_STATUS.VALIDATION_ERROR, 'VALIDATION_ERROR', message, details)
}

export function internalServerError(message: string = API_ERROR_MESSAGE.INTERNAL_SERVER_ERROR, details?: ApiErrorDetails) {
  return new ApiHttpError(API_ERROR_STATUS.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR', message, details)
}

export function tooManyRequestsError(message: string = API_ERROR_MESSAGE.TOO_MANY_REQUESTS) {
  return new ApiHttpError(API_ERROR_STATUS.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS', message)
}

export function zodErrorToValidationDetails(error: ZodError): ValidationErrorDetails {
  const fields: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const fieldPath = issue.path.length > 0 ? issue.path.join('.') : '_root'

    if (!fields[fieldPath]) {
      fields[fieldPath] = []
    }

    fields[fieldPath].push(issue.message)
  }

  return { fields }
}

export function normalizeApiError(error: unknown): ApiHttpError {
  if (error instanceof ApiHttpError) {
    return error
  }

  if (error instanceof ZodError) {
    return validationError(zodErrorToValidationDetails(error))
  }

  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : API_ERROR_STATUS.INTERNAL_SERVER_ERROR
    const codeFromData = 'data' in error && typeof error.data === 'object' && error.data !== null && 'code' in error.data
      ? error.data.code
      : undefined
    const detailsFromData = 'data' in error && typeof error.data === 'object' && error.data !== null && 'details' in error.data
      ? error.data.details
      : undefined
    const code = typeof codeFromData === 'string' ? codeFromData : STATUS_TO_CODE[statusCode] ?? 'INTERNAL_SERVER_ERROR'
    const message = 'statusMessage' in error && typeof error.statusMessage === 'string' && error.statusMessage.length > 0
      ? error.statusMessage
      : error instanceof Error && error.message.length > 0
        ? error.message
        : API_ERROR_MESSAGE[code as keyof typeof API_ERROR_MESSAGE] ?? API_ERROR_MESSAGE.INTERNAL_SERVER_ERROR

    return new ApiHttpError(statusCode, code, message, detailsFromData as ApiErrorDetails)
  }

  return internalServerError()
}

export function defineApiHandler<T>(handler: ApiHandler<T>): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      const normalizedError = normalizeApiError(error)
      setResponseStatus(event, normalizedError.statusCode)

      if (normalizedError.statusCode >= 500) {
        logger.error('unhandled_server_error', {
          route: event.path,
          method: event.method,
          statusCode: normalizedError.statusCode,
          errorCode: normalizedError.code,
          message: normalizedError.message
        })
      }

      return apiError(normalizedError.code, normalizedError.message, normalizedError.details)
    }
  })
}
