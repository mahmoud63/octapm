/**
 * The one way the app talks to OctaPM.
 *
 * A typed client generated from the backend's own OpenAPI document, so a path,
 * a parameter or a response field that does not exist on the server does not
 * compile here. This layer owns exactly what the brief says it should: the
 * base URL, the access token, one single-flight refresh, the standard error
 * model, a request id on every call, awareness of the network, and
 * cancellation. Business modules use the typed operations and nothing else.
 *
 * The client identifies itself with an X-OctaPM-Client header. The server uses
 * it only to choose how the refresh token is delivered — response body for a
 * native app, httpOnly cookie for a browser. It grants nothing.
 */
import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from '@/api/generated/schema'
import { AppError, fromNetwork, fromStatus, type ServerErrorBody } from '@/api/errors'
import { network } from '@/api/network'
import { env } from '@/config/env'
import { log } from '@/utilities/logger'

export const CLIENT_HEADER = 'X-OctaPM-Client'
export const CLIENT_NAME = 'mobile'
export const REQUEST_ID_HEADER = 'X-Request-Id'
const REQUEST_TIMEOUT_MS = 20_000

/** Provided by the auth layer; kept as functions so this module has no store import. */
export interface TokenSource {
  accessToken: () => string | null
  /** Whether the app currently considers someone signed in, token or not. */
  hasSession: () => boolean
  /** Returns a fresh access token, or null if the session is gone. */
  refresh: () => Promise<string | null>
  /** Called when a refresh fails for good: the session must end. */
  onSessionLost: () => void
}

let tokens: TokenSource = {
  accessToken: () => null,
  hasSession: () => false,
  refresh: async () => null,
  onSessionLost: () => undefined,
}

export const bindTokenSource = (source: TokenSource) => {
  tokens = source
}

const newRequestId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** fetch with a deadline, honouring any signal the caller already passed. */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT_MS)
  const outer = init?.signal
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason)
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true })
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

const identify: Middleware = {
  async onRequest({ request }) {
    request.headers.set(CLIENT_HEADER, CLIENT_NAME)
    request.headers.set('Accept', 'application/json')
    if (!request.headers.has(REQUEST_ID_HEADER)) request.headers.set(REQUEST_ID_HEADER, newRequestId())
    const token = tokens.accessToken()
    if (token && !request.headers.has('Authorization')) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  },
}

export const api = createClient<paths>({ baseUrl: env.apiBase, fetch: fetchWithTimeout })
api.use(identify)

/** What every operation of the typed client returns. */
interface Outcome<T> {
  data?: T
  error?: unknown
  response: Response
}

type Envelope<T> = { success?: boolean; data?: T }

const unwrap = <T>(body: unknown): T => {
  if (body && typeof body === 'object' && 'data' in (body as Envelope<T>)) return (body as Envelope<T>).data as T
  return body as T
}

const pathOf = (response: Response): string => {
  try {
    return new URL(response.url).pathname
  } catch {
    return '(unknown path)'
  }
}

export interface RunOptions {
  /** Set false on the refresh call itself, so a 401 there ends the session instead of looping. */
  retryOnUnauthorized?: boolean
  /** Fail immediately with OFFLINE when the device knows it has no connection. Default true. */
  failFastOffline?: boolean
}

/**
 * Run one typed call and return its payload.
 *
 * On a 401 the access token is refreshed once — one refresh for any number of
 * concurrent failures — and the call repeated; a second 401 ends the session.
 * Everything else becomes an AppError carrying the server's request id.
 * `attempt` builds a fresh request each time, which is why it is a function.
 */
export async function run<T>(attempt: () => Promise<Outcome<T>>, options: RunOptions = {}): Promise<Payload<T>> {
  const { retryOnUnauthorized = true, failFastOffline = true } = options
  if (failFastOffline && network.isKnownOffline()) throw new AppError('OFFLINE')
  // No session in memory, so this call would go out with no bearer at all. Its
  // 401 would be indistinguishable from an expired token: the refresh below
  // would run, the retry would be refused again and the session would end —
  // throwing a person out of an app whose session had merely not arrived yet,
  // or had just been given up on the way to the sign-in screen. A call that
  // asks to be retried on 401 is by definition an authenticated one; the
  // sign-in, refresh and sign-out calls pass retryOnUnauthorized: false and
  // are unaffected.
  //
  // A session the app is holding without a token is a different thing and is
  // left alone: opening offline with a saved session does exactly that, on
  // purpose, and its requests should fail as offline rather than be refused
  // here as if the person had been signed out.
  if (retryOnUnauthorized && !tokens.accessToken() && !tokens.hasSession()) throw new AppError('AUTH_REQUIRED')

  let outcome: Outcome<T>
  try {
    outcome = await attempt()
  } catch (error) {
    const failure = fromNetwork(error)
    if (failure.code === 'OFFLINE') network.noteFailure()
    log.warn('network', 'request failed before a response', { code: failure.code })
    throw failure
  }

  network.noteSuccess()
  if (outcome.response.ok) return unwrap<Payload<T>>(outcome.data as unknown)

  const status = outcome.response.status
  if (status === 401 && retryOnUnauthorized) {
    let fresh: string | null = null
    let refreshFailure: unknown = null
    try {
      fresh = await tokens.refresh()
    } catch (error) {
      refreshFailure = error
    }
    if (fresh) return run(attempt, { ...options, retryOnUnauthorized: false })
    // A refused refresh ends the session; a lost signal or a server fault does not.
    if (refreshFailure instanceof AppError && refreshFailure.retryable) throw refreshFailure
    tokens.onSessionLost()
  }

  const body = (outcome.error ?? null) as { error?: ServerErrorBody } | ServerErrorBody | null
  const detail = body && typeof body === 'object' && 'error' in body ? (body as { error?: ServerErrorBody }).error : (body as ServerErrorBody | null)
  const failure = fromStatus(status, detail ?? undefined, outcome.response.headers.get(REQUEST_ID_HEADER))
  log.warn('network', `${status} from ${pathOf(outcome.response)}`, { code: failure.code, serverCode: failure.serverCode, requestId: failure.requestId })
  throw failure
}

/** The inside of the envelope, if the type describes one. */
export type Payload<T> = T extends { data?: infer D } ? D : T

export { AppError }
