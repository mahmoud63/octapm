/**
 * Who is signed in, right now, in memory.
 *
 * The access token lives here and nowhere else: it is short-lived and is never
 * written to disk. The refresh token is the only thing persisted, and it goes
 * to the platform keychain through secure-storage. The store holds state; the
 * session module holds the behaviour.
 */
import { create } from 'zustand'
import type { RoleId } from '@/permissions/policy'

export type AuthStatus =
  /** The app has started and has not yet checked for a saved session. */
  | 'booting'
  | 'signedOut'
  /** A saved session exists and biometric unlock is on; nothing is shown until it is unlocked. */
  | 'locked'
  | 'signedIn'

export interface SessionUser {
  id: string
  orgId: string
  name: string
  email: string
  role: RoleId | string
  isCompanyAdmin: boolean
  status: string
  mfaEnabled?: boolean
}

interface AuthState {
  status: AuthStatus
  user: SessionUser | null
  accessToken: string | null
  /** Epoch milliseconds when the access token stops working. */
  accessExpiresAt: number | null
  biometricEnabled: boolean
  /** Why the last session ended, for the sign-in screen to explain. */
  lastSignOutReason: 'user' | 'expired' | 'revoked' | null

  setBooting: () => void
  setSignedIn: (user: SessionUser, accessToken: string, expiresInSeconds: number) => void
  setAccessToken: (accessToken: string, expiresInSeconds: number) => void
  setLocked: () => void
  setSignedOut: (reason: AuthState['lastSignOutReason']) => void
  setBiometricEnabled: (enabled: boolean) => void
  setUser: (user: SessionUser) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'booting',
  user: null,
  accessToken: null,
  accessExpiresAt: null,
  biometricEnabled: false,
  lastSignOutReason: null,

  setBooting: () => set({ status: 'booting' }),
  setSignedIn: (user, accessToken, expiresInSeconds) =>
    set({ status: 'signedIn', user, accessToken, accessExpiresAt: Date.now() + expiresInSeconds * 1000, lastSignOutReason: null }),
  setAccessToken: (accessToken, expiresInSeconds) => set({ accessToken, accessExpiresAt: Date.now() + expiresInSeconds * 1000 }),
  setLocked: () => set({ status: 'locked', accessToken: null, accessExpiresAt: null }),
  setSignedOut: (reason) => set({ status: 'signedOut', user: null, accessToken: null, accessExpiresAt: null, lastSignOutReason: reason }),
  setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled }),
  setUser: (user) => set({ user }),
}))

export const selectUser = (s: AuthState) => s.user
export const selectStatus = (s: AuthState) => s.status
export const selectRole = (s: AuthState) => s.user?.role ?? null

/**
 * Session readiness, as three answers rather than one boolean.
 *
 * `Boolean(accessToken)` cannot tell a session still being restored from a
 * person who is genuinely signed out, and the difference matters twice over.
 * A request sent before the token is in memory carries no bearer; the client
 * cannot tell that 401 from an expired one, so it refreshes, retries, is
 * refused and ends the session. And a screen that reads "not ready" as "no
 * data" tells the person their workspace is empty when it is merely still
 * arriving.
 *
 * So: queries that need a session run only when `authenticated`, and screens
 * render `restoring` as a loading state, never as empty.
 */
export type SessionReadiness = 'restoring' | 'authenticated' | 'unauthenticated'

export const sessionReadiness = (status: AuthStatus): SessionReadiness => {
  if (status === 'signedIn') return 'authenticated'
  // 'locked' holds a saved session behind a biometric prompt: not signed out,
  // and not something to send a request with either.
  if (status === 'booting' || status === 'locked') return 'restoring'
  return 'unauthenticated'
}

/** The readiness of the session right now. */
export const useSessionReadiness = (): SessionReadiness => useAuthStore((s) => sessionReadiness(s.status))

/** True only when there is a session to make an authenticated request with. */
export const useAuthenticated = (): boolean => useAuthStore((s) => s.status === 'signedIn')
