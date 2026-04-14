import type { AuthUser } from '@/services/auth/types'
import { create } from 'zustand'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

const ACCESS_TOKEN_COOKIE = 'pmc_access_token'
const REFRESH_TOKEN_COOKIE = 'pmc_refresh_token'

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    refreshToken: string
    setRefreshToken: (refreshToken: string) => void
    setSession: (
      user: AuthUser,
      accessToken: string,
      refreshToken: string
    ) => void
    hasSession: () => boolean
    resetAccessToken: () => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set, get) => {
  const initialAccessToken = getCookie(ACCESS_TOKEN_COOKIE) || ''
  const initialRefreshToken = getCookie(REFRESH_TOKEN_COOKIE) || ''

  return {
    auth: {
      user: null,
      setUser: (user) =>
        set((state) => ({ ...state, auth: { ...state.auth, user } })),
      accessToken: initialAccessToken,
      setAccessToken: (accessToken) =>
        set((state) => {
          if (accessToken) {
            setCookie(ACCESS_TOKEN_COOKIE, accessToken)
          } else {
            removeCookie(ACCESS_TOKEN_COOKIE)
          }

          return { ...state, auth: { ...state.auth, accessToken } }
        }),
      refreshToken: initialRefreshToken,
      setRefreshToken: (refreshToken) =>
        set((state) => {
          if (refreshToken) {
            setCookie(REFRESH_TOKEN_COOKIE, refreshToken)
          } else {
            removeCookie(REFRESH_TOKEN_COOKIE)
          }

          return { ...state, auth: { ...state.auth, refreshToken } }
        }),
      setSession: (user, accessToken, refreshToken) =>
        set((state) => {
          setCookie(ACCESS_TOKEN_COOKIE, accessToken)
          setCookie(REFRESH_TOKEN_COOKIE, refreshToken)

          return {
            ...state,
            auth: {
              ...state.auth,
              user,
              accessToken,
              refreshToken,
            },
          }
        }),
      hasSession: () => {
        const { accessToken, refreshToken } = get().auth
        return Boolean(accessToken || refreshToken)
      },
      resetAccessToken: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN_COOKIE)
          return { ...state, auth: { ...state.auth, accessToken: '' } }
        }),
      reset: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN_COOKIE)
          removeCookie(REFRESH_TOKEN_COOKIE)
          return {
            ...state,
            auth: {
              ...state.auth,
              user: null,
              accessToken: '',
              refreshToken: '',
            },
          }
        }),
    },
  }
})
