/**
 * Structured client logging.
 *
 * Every entry is a plain object with a level, a category and a message, kept
 * in a short ring buffer so a support report can carry the last few minutes
 * without a debugger attached. Values that look like credentials are redacted
 * before they are stored or printed: a token in a log is a token in a
 * screenshot.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'network' | 'sync' | 'navigation' | 'auth' | 'upload' | 'notification' | 'crash' | 'app'

export interface LogEntry {
  at: string
  level: LogLevel
  category: LogCategory
  message: string
  data?: Record<string, unknown>
}

const SENSITIVE = /(token|password|secret|authorization|cookie|apikey|api_key|refresh)/i
const RING = 400

const buffer: LogEntry[] = []
const sinks: ((entry: LogEntry) => void)[] = []

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE.test(key) ? '[redacted]' : redact(inner, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 200)}… (${value.length} chars)`
  return value
}

function write(level: LogLevel, category: LogCategory, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    at: new Date().toISOString(),
    level,
    category,
    message,
    ...(data ? { data: redact(data) as Record<string, unknown> } : {}),
  }
  buffer.push(entry)
  if (buffer.length > RING) buffer.shift()
  for (const sink of sinks) sink(entry)
  if (__DEV__ && (level === 'error' || level === 'warn')) {
    const line = `[${category}] ${message}`
    if (level === 'error') console.error(line, entry.data ?? '')
    else console.warn(line, entry.data ?? '')
  }
}

export const log = {
  debug: (category: LogCategory, message: string, data?: Record<string, unknown>) => write('debug', category, message, data),
  info: (category: LogCategory, message: string, data?: Record<string, unknown>) => write('info', category, message, data),
  warn: (category: LogCategory, message: string, data?: Record<string, unknown>) => write('warn', category, message, data),
  error: (category: LogCategory, message: string, data?: Record<string, unknown>) => write('error', category, message, data),
  /** The recent entries, oldest first, for a support report. */
  recent: (): readonly LogEntry[] => buffer.slice(),
  /** Attach a sink, for example a crash reporter once one is configured. */
  addSink: (sink: (entry: LogEntry) => void) => {
    sinks.push(sink)
    return () => {
      const at = sinks.indexOf(sink)
      if (at >= 0) sinks.splice(at, 1)
    }
  },
}
