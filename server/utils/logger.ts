/**
 * Shared structured logger for server-side observability.
 *
 * All log entries are emitted as JSON lines so they are machine-readable in
 * any deployment environment without additional setup.
 *
 * Sensitive field names are redacted before emission so that OAuth tokens,
 * session cookies, auth codes, and client secrets never appear in logs.
 *
 * Log level is controlled by the LOG_LEVEL environment variable:
 *   debug | info | warn | error   (default: info)
 */

/** Keys whose values are unconditionally replaced with "[REDACTED]". */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'client_secret',
  'clientsecret',
  'session',
  'cookie',
  'set-cookie',
  'code',
  'state',
  'password',
  'secret',
  'token',
  'idempotencykey',
  'idempotency_key',
  'x-todoist-hmac-sha256'
])

const REDACTED = '[REDACTED]'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

function getConfiguredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  if (raw in LEVEL_ORDER) return raw as LogLevel
  return 'info'
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getConfiguredLevel()]
}

/**
 * Recursively walk `value` and redact sensitive keys.
 * Long string values (likely blobs or tokens not caught by key name) are also
 * truncated to avoid flooding logs with encoded token material.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEEP]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 80)}...[truncated]` : value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(item => redactForLog(item, depth + 1))
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = REDACTED
    } else {
      result[key] = redactForLog(val, depth + 1)
    }
  }
  return result
}

function write(level: LogLevel, event: string, context: Record<string, unknown>): void {
  if (!shouldLog(level)) return

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redactForLog(context) as Record<string, unknown>)
  }

  const line = JSON.stringify(entry)

  if (level === 'error' || level === 'warn') {
    console.error(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug(event: string, context: Record<string, unknown> = {}): void {
    write('debug', event, context)
  },

  info(event: string, context: Record<string, unknown> = {}): void {
    write('info', event, context)
  },

  warn(event: string, context: Record<string, unknown> = {}): void {
    write('warn', event, context)
  },

  error(event: string, context: Record<string, unknown> = {}): void {
    write('error', event, context)
  }
}
