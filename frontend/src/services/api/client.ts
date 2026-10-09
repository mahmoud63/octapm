import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
  type AxiosRequestHeaders,
  type AxiosRequestConfig,
} from 'axios'
import type { AuthSession, ApiSuccess } from '@/services/auth/types'
import { useAuthStore } from '@/stores/auth-store'

const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || '/api/v1'

interface RetriableRequestConfig extends AxiosRequestConfig {
  _retry?: boolean
  _sentBy?: string | null
  headers?: AxiosRequestHeaders | Record<string, string>
}

type PendingRequest = {
  resolve: (token: string) => void
  reject: (error: unknown) => void
}

const pendingRequests: PendingRequest[] = []
let isRefreshing = false

/**
 * 401 SESSION_REVOKED (D-ID-1 Q6): the token was minted before the person's
 * last password reset, account close or administrator MFA reset, and is
 * refused everywhere. It is an ended session, never an error to show.
 */
export const isSessionRevokedError = (error: unknown) =>
  axios.isAxiosError(error) &&
  error.response?.status === 401 &&
  (error.response.data as { error?: { code?: string } } | undefined)?.error
    ?.code === 'SESSION_REVOKED'

/**
 * The SESSION_REVOKED errors of a signed-in person's session, as the response
 * interceptor below hands them to the callers: by then it has reset the store
 * and sent the person to sign in once — or the person who sent the request is
 * no longer the one signed in — so nothing else is to be shown for them.
 */
const endedSessionErrors = new WeakSet<object>()
const markEndedSession = (error: unknown) => {
  if (typeof error === 'object' && error !== null) endedSessionErrors.add(error)
}

/**
 * Whether a handler shows nothing for this error (D-ID-1 N4): a signed-in
 * session's SESSION_REVOKED, which the request layer has already announced.
 * A SESSION_REVOKED nobody announced — a sign-in step, or an invitation
 * accepted with the token a sign-in just returned, with nobody signed in —
 * is not one of these: the handler shows it like any other refusal.
 */
export const isEndedSession = (error: unknown) =>
  isSessionRevokedError(error) && endedSessionErrors.has(error as object)

type SessionEndedListener = () => void
let sessionEndedListener: SessionEndedListener | null = null

/** main.tsx registers where an ended session goes (the sign-in page). */
export const onSessionEnded = (listener: SessionEndedListener) => {
  sessionEndedListener = listener
}

/** No stored-session header: for a request that carries its own bearer (a workspace re-entry, an invitation acceptance). */
export const authlessClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
})

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
})

/**
 * The web refresh cookie is one per browser, and every workspace switch
 * replaces it (workspace switching doc §2, step 4). A tab on `/o/acme` whose
 * refresh comes back bound to `beta` — another tab switched — must not
 * install that token under its own workspace: from then on every request
 * would be answered for `beta` under `acme`'s name and URL, and a write from
 * the tab would land in `beta`. The tab re-enters the workspace its URL
 * names with the refreshed token first (the same reverse switch browser Back
 * relies on), and only a session bound to that workspace is installed. A
 * re-entry that is refused (the person's access there ended meanwhile) fails
 * the refresh, which ends this tab's session rather than continuing it under
 * a workspace it is no longer in.
 */
const boundToCurrentWorkspace = async (
  session: AuthSession
): Promise<AuthSession> => {
  const bound = useAuthStore.getState().auth.workspace
  if (!bound || session.user.orgId === bound.orgId) return session
  const response = await authlessClient.post<ApiSuccess<AuthSession>>(
    `/auth/workspaces/${encodeURIComponent(bound.orgId)}/session`,
    {},
    { headers: { Authorization: `Bearer ${session.tokens.accessToken}` } }
  )
  return response.data.data
}

const flushPendingRequests = (error: unknown, token?: string) => {
  while (pendingRequests.length) {
    const pending = pendingRequests.shift()
    if (!pending) continue

    if (error) {
      pending.reject(error)
    } else if (token) {
      pending.resolve(token)
    }
  }
}

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken, user } = useAuthStore.getState().auth

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  // Who sent it: a request is only ever retried for that person (CX21-484).
  ;(config as RetriableRequestConfig)._sentBy = user?.id ?? null

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined

    if (!originalRequest || error.response?.status !== 401) {
      return Promise.reject(error)
    }

    const requestUrl = originalRequest.url || ''
    const isAuthRequest =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/register') ||
      requestUrl.includes('/auth/refresh') ||
      requestUrl.includes('/auth/logout')

    if (originalRequest._retry || isAuthRequest) {
      // A request retried after a successful refresh and refused again as an
      // ended session (a credential event landed after the refresh) ends the
      // session here, once: the first such answer resets the store and sends
      // the person to sign in; a later one finds the store already empty. The
      // callers show nothing for it (isEndedSession), so without this the
      // session would end in silence (D-ID-1 N4).
      if (originalRequest._retry && isSessionRevokedError(error)) {
        const retriedFor = originalRequest._sentBy ?? null
        if (retriedFor !== null) {
          markEndedSession(error)
          const { auth: retriedAuth } = useAuthStore.getState()
          if ((retriedAuth.user?.id ?? null) === retriedFor) {
            retriedAuth.reset()
            sessionEndedListener?.()
          }
        }
      }
      return Promise.reject(error)
    }
    // A late 401 for a request the previous person sent is not retried under
    // whoever is signed in now (Phase 21D, CX21-484).
    const sentBy = originalRequest._sentBy ?? null
    const signedInNow = useAuthStore.getState().auth.user?.id ?? null
    if (sentBy !== null && sentBy !== signedInNow) {
      // Its SESSION_REVOKED belongs to a session already ended (announced by
      // the request that ended it) or to a person no longer signed in here:
      // nothing to show (D-ID-1 N4).
      if (isSessionRevokedError(error)) markEndedSession(error)
      return Promise.reject(error)
    }

    const { auth } = useAuthStore.getState()
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingRequests.push({
          resolve: (token: string) => {
            originalRequest.headers = originalRequest.headers || {}
            originalRequest.headers.Authorization = `Bearer ${token}`
            resolve(apiClient(originalRequest))
          },
          reject,
        })
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    const askedFor = useAuthStore.getState().auth.user?.id ?? null
    try {
      const refreshResponse = await authlessClient.post<
        ApiSuccess<AuthSession>
      >('/auth/refresh')

      const session = await boundToCurrentWorkspace(refreshResponse.data.data)
      // The identity may have changed while the refresh was in flight — a
      // sign-out, or another person signing in on this tab. A late answer
      // for the previous person must not be installed over the current one
      // (Phase 21D, CX21-477).
      const current = useAuthStore.getState().auth.user?.id ?? null
      // A tab with nobody signed in yet (the refresh cookie signing someone
      // in on load) is not a change of identity.
      const freshTab = askedFor === null && current === null
      if (!freshTab && (current !== askedFor || session.user.id !== askedFor)) {
        const stale = new Error('The session changed while it was being refreshed')
        flushPendingRequests(stale)
        return Promise.reject(stale)
      }
      auth.setSession(session.user, session.tokens.accessToken, {
        workspace: session.workspace,
        memberships: session.memberships,
      })

      flushPendingRequests(null, session.tokens.accessToken)

      originalRequest.headers = originalRequest.headers || {}
      originalRequest.headers.Authorization = `Bearer ${session.tokens.accessToken}`

      return apiClient(originalRequest)
    } catch (refreshError) {
      // A revoked session answers the request with SESSION_REVOKED and the
      // refresh with whatever its revoked family says (REFRESH_TOKEN_REUSED,
      // say). Every caller is then given the SESSION_REVOKED error, which the
      // handlers treat as an ended session rather than an error to show — one
      // toast, from the listener below, not one per waiting request (D-ID-1 N4).
      const ended = isSessionRevokedError(error)
        ? error
        : isSessionRevokedError(refreshError)
          ? refreshError
          : null
      const failure = ended ?? refreshError
      // A signed-in person's ended session is announced below, once (or not
      // at all when someone else signed in meanwhile): every caller handed
      // this error shows nothing for it (isEndedSession).
      if (ended && askedFor !== null) markEndedSession(ended)
      flushPendingRequests(failure)
      // A refresh that failed for the previous person must not sign out the
      // person who signed in meanwhile.
      if ((useAuthStore.getState().auth.user?.id ?? null) === askedFor) {
        auth.reset()
        // A revoked session (the request's token, or the refresh's family)
        // goes to the sign-in page once, like an expired one — the store is
        // already empty, so the query cache's 401 handler would not.
        if (askedFor !== null && ended) {
          sessionEndedListener?.()
        }
      }
      return Promise.reject(failure)
    } finally {
      isRefreshing = false
    }
  }
)
