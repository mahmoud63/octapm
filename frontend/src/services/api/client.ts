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

const authlessClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
})

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
})

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
      return Promise.reject(error)
    }
    // A late 401 for a request the previous person sent is not retried under
    // whoever is signed in now (Phase 21D, CX21-484).
    const sentBy = originalRequest._sentBy ?? null
    const signedInNow = useAuthStore.getState().auth.user?.id ?? null
    if (sentBy !== null && sentBy !== signedInNow) {
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

      const session = refreshResponse.data.data
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
      auth.setSession(session.user, session.tokens.accessToken)

      flushPendingRequests(null, session.tokens.accessToken)

      originalRequest.headers = originalRequest.headers || {}
      originalRequest.headers.Authorization = `Bearer ${session.tokens.accessToken}`

      return apiClient(originalRequest)
    } catch (refreshError) {
      flushPendingRequests(refreshError)
      // A refresh that failed for the previous person must not sign out the
      // person who signed in meanwhile.
      if ((useAuthStore.getState().auth.user?.id ?? null) === askedFor) auth.reset()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  }
)
