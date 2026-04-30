export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_SERVER_ERROR'
  | (string & {})

export interface CollectionMeta {
  page: number
  pageSize: number
  total: number
}

export interface ValidationErrorDetails {
  fields: Record<string, string[]>
}

export interface ApiSuccessResponse<T> {
  data: T
}

export interface ApiCollectionResponse<T> {
  data: T[]
  meta: CollectionMeta
}

export interface ApiActionResponse {
  data: {
    success: boolean
    message: string
  }
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    details?: Record<string, unknown> | ValidationErrorDetails
  }
}
