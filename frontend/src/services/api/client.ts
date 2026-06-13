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
  const accessToken = useAuthStore.getState().auth.accessToken

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }

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

    try {
      const refreshResponse = await authlessClient.post<
        ApiSuccess<AuthSession>
      >('/auth/refresh')

      const session = refreshResponse.data.data
      auth.setSession(session.user, session.tokens.accessToken)

      flushPendingRequests(null, session.tokens.accessToken)

      originalRequest.headers = originalRequest.headers || {}
      originalRequest.headers.Authorization = `Bearer ${session.tokens.accessToken}`

      return apiClient(originalRequest)
    } catch (refreshError) {
      flushPendingRequests(refreshError)
      auth.reset()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  }
)
