/**
 * What the user is told when something fails.
 *
 * The server's error carries a code and a message written for developers. A
 * person on site gets a sentence about what happened and what they can do; the
 * original code, the server's request id and the details stay on the error
 * object for the log and for a support conversation.
 */
export type AppErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'SERVER_ERROR'
  | 'UNKNOWN'

export interface ServerErrorBody {
  code?: string
  message?: string
  details?: unknown
  requestId?: string
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number | undefined
  /** The server's own error code, for the log. */
  readonly serverCode: string | undefined
  /** The server's request id, so support can find the request in its logs. */
  readonly requestId: string | undefined
  readonly details: unknown
  /** What to show the person. Never a stack trace, never an identifier. */
  readonly userMessage: string
  readonly retryable: boolean

  constructor(code: AppErrorCode, options: { status?: number; serverCode?: string; message?: string; details?: unknown; requestId?: string } = {}) {
    super(options.message ?? code)
    this.name = 'AppError'
    this.code = code
    this.status = options.status
    this.serverCode = options.serverCode
    this.requestId = options.requestId
    this.details = options.details
    this.userMessage = describe(code, options.message)
    this.retryable = code === 'OFFLINE' || code === 'TIMEOUT' || code === 'SERVER_ERROR' || code === 'RATE_LIMITED'
  }

  /** A short line for a support conversation: the code and, if the server gave one, the request id. */
  get reference(): string {
    return this.requestId ? `${this.code} · ref ${this.requestId}` : this.code
  }
}

function describe(code: AppErrorCode, message: string | undefined): string {
  switch (code) {
    case 'OFFLINE':
      return 'You are offline. What you save will be kept and sent when the connection returns.'
    case 'TIMEOUT':
      return 'The server took too long to answer. Check the connection and try again.'
    case 'CANCELLED':
      return 'That request was cancelled.'
    case 'AUTH_REQUIRED':
      return 'Your session has ended. Sign in again to continue.'
    case 'FORBIDDEN':
      return 'Your role does not allow this on this project. Ask your project manager if you think it should.'
    case 'NOT_FOUND':
      return 'That record is no longer available. It may have been removed or moved to another project.'
    case 'CONFLICT':
      return 'Somebody else changed this record first. Review the latest version before saving again.'
    case 'VALIDATION':
      return message && !looksTechnical(message) ? message : 'Some of the details are missing or not valid. Check the highlighted fields.'
    case 'RATE_LIMITED':
      return 'Too many attempts in a short time. Wait a moment and try again.'
    case 'SERVER_ERROR':
      return 'OctaPM had a problem on the server. Nothing you entered has been lost; try again in a moment.'
    default:
      return 'Something went wrong. Try again, and tell support what you were doing if it keeps happening.'
  }
}

/** Identifiers, stack frames and library names have no place on a screen. */
export const looksTechnical = (text: string) =>
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|prisma|sql|stack|at\s+\w+\s+\(|undefined|null|TypeError|ECONN|ENOTFOUND|invocation/i.test(text)

export function fromStatus(status: number, body: ServerErrorBody | undefined, requestIdHeader?: string | null): AppError {
  const base = {
    status,
    serverCode: body?.code,
    message: body?.message,
    details: body?.details,
    requestId: body?.requestId ?? requestIdHeader ?? undefined,
  }
  if (status === 401) return new AppError('AUTH_REQUIRED', base)
  if (status === 403) return new AppError('FORBIDDEN', base)
  if (status === 404) return new AppError('NOT_FOUND', base)
  if (status === 409 || status === 412) return new AppError('CONFLICT', base)
  if (status === 400 || status === 422) return new AppError('VALIDATION', base)
  if (status === 429) return new AppError('RATE_LIMITED', base)
  if (status >= 500) return new AppError('SERVER_ERROR', base)
  return new AppError('UNKNOWN', base)
}

export function fromNetwork(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError' && /cancel/i.test(message)) return new AppError('CANCELLED', { message })
  if (name === 'AbortError' || /timeout|timed out|abort/i.test(message)) return new AppError('TIMEOUT', { message })
  if (/network|fetch|ECONN|ENOTFOUND|Failed to fetch|offline/i.test(message)) return new AppError('OFFLINE', { message })
  return new AppError('UNKNOWN', { message })
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError

/** For any thrown value, the sentence to show. */
export function userMessage(error: unknown): string {
  if (isAppError(error)) return error.userMessage
  return describe('UNKNOWN', undefined)
}
