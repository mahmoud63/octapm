import type { AuthUser } from '@/services/auth/types'
import { create } from 'zustand'

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    setSession: (user: AuthUser, accessToken: string) => void
    hasSession: () => boolean
    resetAccessToken: () => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set, get) => {
  return {
    auth: {
      user: null,
      setUser: (user) =>
        set((state) => ({ ...state, auth: { ...state.auth, user } })),
      accessToken: '',
      setAccessToken: (accessToken) =>
        set((state) => ({ ...state, auth: { ...state.auth, accessToken } })),
      setSession: (user, accessToken) =>
        set((state) => ({
          ...state,
          auth: {
            ...state.auth,
            user,
            accessToken,
          },
        })),
      hasSession: () => {
        const { accessToken, user } = get().auth
        return Boolean(accessToken || user)
      },
      resetAccessToken: () =>
        set((state) => ({ ...state, auth: { ...state.auth, accessToken: '' } })),
      reset: () =>
        set((state) => ({
          ...state,
          auth: {
            ...state.auth,
            user: null,
            accessToken: '',
          },
        })),
    },
  }
})
