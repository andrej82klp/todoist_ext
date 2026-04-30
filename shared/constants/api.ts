export const PRIORITY_LEVELS = ['low', 'medium', 'high'] as const

export const STREAK_BONUS_STRATEGIES = ['fixed', 'percentage'] as const

export const LEDGER_TRANSACTION_TYPES = ['earned', 'spent', 'bonus', 'adjusted'] as const

export const STREAK_RULE_TYPES = ['completed_items', 'points'] as const

export const SORT_ORDERS = ['asc', 'desc'] as const

export const TASK_SORT_FIELDS = ['priority', 'difficulty', 'estimatedPoints', 'deadline'] as const

export const API_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  INTERNAL_SERVER_ERROR: 500
} as const

export const API_ERROR_MESSAGE = {
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'You do not have access to this resource',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Request conflicts with current resource state',
  VALIDATION_ERROR: 'Invalid request payload',
  INTERNAL_SERVER_ERROR: 'Internal server error'
} as const

export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100
