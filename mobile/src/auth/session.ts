/**
 * The session: signing in, staying in, and leaving.
 *
 * Sign-in exchanges credentials for an access token and a refresh token. The
 * access token stays in memory; the refresh token goes to the keychain. On a
 * cold start the keychain is consulted, the refresh token is presented to the
 * server, and only if the server still honours it does the app open. Biometric
 * unlock sits in front of that exchange, not instead of it.
 *
 * The server rotates refresh tokens and revokes the family on reuse, so a
 * token is used exactly once: whatever comes back replaces it immediately.
 */
import { api, bindTokenSource, run } from '@/api/client'
import { AppError, isAppError } from '@/api/errors'
import { forgetEverything } from '@/api/query'
import { analytics } from '@/analytics'
import { promptBiometric } from '@/auth/biometric'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useProjectStore } from '@/projects/store'
import { useAuthStore, type SessionUser } from '@/auth/store'
import { log } from '@/utilities/logger'

interface TokenPayload {
  accessToken: string
  expiresIn: number
  refreshToken?: string
  refreshTokenExpiresAt?: string
}

interface AuthResult {
  user: SessionUser
  tokens: TokenPayload
}

let refreshing: Promise<string | null> | null = null

const store = () => useAuthStore.getState()

async function keepRefreshToken(payload: TokenPayload | undefined) {
  if (payload?.refreshToken) await secureStorage.set(STORAGE_KEYS.refreshToken, payload.refreshToken)
}

async function rememberProfile(user: SessionUser) {
  await secureStorage.set(STORAGE_KEYS.profile, JSON.stringify(user))
}

async function lastKnownProfile(): Promise<SessionUser | null> {
  const raw = await secureStorage.get(STORAGE_KEYS.profile)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionUser
  } catch {
    return null
  }
}

async function applyResult(result: AuthResult, method: 'password' | 'biometric' | 'restored') {
  await keepRefreshToken(result.tokens)
  await rememberProfile(result.user)
  store().setSignedIn(result.user, result.tokens.accessToken, result.tokens.expiresIn)
  await secureStorage.set(STORAGE_KEYS.lastEmail, result.user.email)
  analytics.track({ name: 'mobile_login', method })
}

/**
 * Trade the stored refresh token for a new pair. Shared, so that ten requests
 * hitting a 401 together cause one refresh, not ten.
 */
export function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const stored = await secureStorage.get(STORAGE_KEYS.refreshToken)
    if (!stored) return null
    try {
      const result = await run<AuthResult>(
        () => api.POST('/auth/refresh', { body: { refreshToken: stored } as never }) as never,
        { retryOnUnauthorized: false }
      )
      await keepRefreshToken(result.tokens)
      if (result.user) await rememberProfile(result.user)
      const current = store()
      if (current.status === 'signedIn' || current.status === 'booting' || current.status === 'locked') {
        if (current.user) current.setAccessToken(result.tokens.accessToken, result.tokens.expiresIn)
        else current.setSignedIn(result.user, result.tokens.accessToken, result.tokens.expiresIn)
      }
      return result.tokens.accessToken
    } catch (error) {
      if (isAppError(error) && (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN')) {
        log.info('auth', 'refresh refused; session is over', { code: error.code, serverCode: error.serverCode })
        await endLocally(error.code === 'FORBIDDEN' ? 'revoked' : 'expired')
        return null
      }
      // Offline or a server hiccup: keep the session, keep the token, try later.
      log.warn('auth', 'refresh failed transiently', { message: String(error) })
      throw error
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function endLocally(reason: 'user' | 'expired' | 'revoked') {
  forgetEverything()
  await useProjectStore.getState().clear()
  await Promise.all([secureStorage.remove(STORAGE_KEYS.refreshToken), secureStorage.remove(STORAGE_KEYS.profile)])
  store().setSignedOut(reason)
  if (reason !== 'user') analytics.track({ name: 'mobile_logout' })
}

export async function signIn(email: string, password: string): Promise<void> {
  const result = await run<AuthResult>(
    () => api.POST('/auth/login', { body: { email, password } as never }) as never,
    { retryOnUnauthorized: false }
  )
  await applyResult(result, 'password')
}

export async function signOut(): Promise<void> {
  const stored = await secureStorage.get(STORAGE_KEYS.refreshToken)
  try {
    if (stored) await run(() => api.POST('/auth/logout', { body: { refreshToken: stored } as never }) as never, { retryOnUnauthorized: false })
  } catch (error) {
    // The server may be unreachable; the local session ends regardless.
    log.warn('auth', 'logout call failed; ending locally', { message: String(error) })
  }
  analytics.track({ name: 'mobile_logout' })
  await endLocally('user')
}

/** On launch: is there a session to resume, and is it still honoured? */
export async function bootstrap(): Promise<void> {
  const [stored, biometric] = await Promise.all([secureStorage.get(STORAGE_KEYS.refreshToken), secureStorage.get(STORAGE_KEYS.biometricUnlock)])
  store().setBiometricEnabled(biometric === 'on')
  if (!stored) {
    store().setSignedOut(null)
    return
  }
  if (biometric === 'on') {
    store().setLocked()
    return
  }
  await resume('restored')
}

async function resume(method: 'biometric' | 'restored') {
  try {
    const token = await refreshSession()
    if (!token) return
    const me = await run<SessionUser>(() => api.GET('/auth/me') as never, { retryOnUnauthorized: false })
    store().setUser(me)
    await rememberProfile(me)
    analytics.track({ name: 'mobile_login', method })
  } catch (error) {
    if (isAppError(error) && error.retryable) {
      // Offline at launch with a saved session: open with what is cached. The
      // next successful request will refresh; a refusal then ends the session.
      const current = store()
      const user = current.user ?? (await lastKnownProfile())
      if (user) {
        current.setSignedIn(user, current.accessToken ?? '', 0)
        log.info('auth', 'opened offline with the last known session')
      } else {
        // Nothing is known about this person yet; the token stays for next time.
        current.setSignedOut(null)
      }
      return
    }
    if (!isAppError(error)) throw error
  }
}

export async function unlock(): Promise<boolean> {
  const passed = await promptBiometric()
  if (!passed) return false
  store().setBooting()
  await resume('biometric')
  return store().status === 'signedIn'
}

export async function setBiometricUnlock(enabled: boolean): Promise<void> {
  if (enabled) await secureStorage.set(STORAGE_KEYS.biometricUnlock, 'on')
  else await secureStorage.remove(STORAGE_KEYS.biometricUnlock)
  store().setBiometricEnabled(enabled)
}

/** Ends the session when the server has said so, wherever that happened. */
export async function sessionLost(): Promise<void> {
  if (store().status === 'signedOut') return
  await endLocally('expired')
}

bindTokenSource({
  accessToken: () => store().accessToken,
  refresh: refreshSession,
  onSessionLost: () => {
    void sessionLost()
  },
})

export { AppError }
