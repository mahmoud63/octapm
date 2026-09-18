import { deadNetwork, envelope, failure, fakeServer } from '@/testing/fake-server'
import { STORAGE_KEYS, secureStorage } from './secure-storage'
import { bootstrap, refreshSession, signIn, signOut } from './session'
import { useAuthStore } from './store'

/**
 * The session against a fake server. Every response here is the shape the
 * real backend returns for a native client: tokens in the body, no cookie.
 */
const user = { id: 'u1', orgId: 'o1', name: 'Dana Okafor', email: 'pm@octapm.demo', role: 'pm', isCompanyAdmin: true, status: 'active' }
const session = (suffix: string) =>
  envelope({ user, tokens: { accessToken: `access-${suffix}`, expiresIn: 900, refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-01-01T00:00:00Z' } })

beforeEach(() => {
  useAuthStore.setState({ status: 'booting', user: null, accessToken: null, accessExpiresAt: null, biometricEnabled: false, lastSignOutReason: null })
})

describe('signing in', () => {
  it('keeps the access token in memory and the refresh token in the keychain', async () => {
    const calls = fakeServer({ 'POST /auth/login': () => ({ status: 200, body: session('1') }) })
    await signIn('pm@octapm.demo', 'DemoPassw0rd!')
    const state = useAuthStore.getState()
    expect(state.status).toBe('signedIn')
    expect(state.user?.name).toBe('Dana Okafor')
    expect(state.accessToken).toBe('access-1')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-1')
    expect(calls[0]?.headers['x-octapm-client']).toBe('mobile')
    expect(calls[0]?.body).toEqual({ email: 'pm@octapm.demo', password: 'DemoPassw0rd!' })
  })

  it('turns a refused login into a sentence, not a stack', async () => {
    fakeServer({ 'POST /auth/login': () => failure(401, 'INVALID_CREDENTIALS', 'Invalid credentials') })
    await expect(signIn('x@y.z', 'nope')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(useAuthStore.getState().status).toBe('booting')
  })
})

describe('staying signed in', () => {
  it('resumes a saved session by presenting the refresh token, and rotates it', async () => {
    await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-old')
    const calls = fakeServer({
      'POST /auth/refresh': () => ({ status: 200, body: session('new') }),
      'GET /auth/me': () => ({ status: 200, body: envelope(user) }),
    })
    await bootstrap()
    expect(useAuthStore.getState().status).toBe('signedIn')
    expect(calls.find((c) => c.path === '/auth/refresh')?.body).toEqual({ refreshToken: 'refresh-old' })
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-new')
  })

  it('ends the session when the server no longer honours the refresh token', async () => {
    await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-revoked')
    fakeServer({ 'POST /auth/refresh': () => failure(401, 'REFRESH_TOKEN_REUSED', 'Refresh token has already been used') })
    await bootstrap()
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().lastSignOutReason).toBe('expired')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()
  })

  it('does not end the session on a transient failure', async () => {
    await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-keep')
    deadNetwork()
    await expect(refreshSession()).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-keep')
  })

  it('waits for biometric unlock when it is turned on', async () => {
    await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-1')
    await secureStorage.set(STORAGE_KEYS.biometricUnlock, 'on')
    fakeServer({})
    await bootstrap()
    expect(useAuthStore.getState().status).toBe('locked')
  })

  it('refreshes once when ten requests fail together', async () => {
    await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-1')
    const calls = fakeServer({ 'POST /auth/refresh': () => ({ status: 200, body: session('2') }) })
    await Promise.all(Array.from({ length: 10 }, () => refreshSession()))
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1)
  })
})

describe('signing out', () => {
  it('tells the server, clears the keychain and the cache, even if the server is down', async () => {
    await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-1')
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1' })
    deadNetwork()
    await signOut()
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().lastSignOutReason).toBe('user')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()
  })

  it('presents the refresh token so the server can revoke the session family', async () => {
    await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-1')
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1' })
    const calls = fakeServer({ 'POST /auth/logout': () => ({ status: 200, body: envelope({ revoked: true }) }) })
    await signOut()
    const logout = calls.find((c) => c.path === '/auth/logout')
    expect(logout?.body).toEqual({ refreshToken: 'refresh-1' })
    expect(logout?.headers['x-octapm-client']).toBe('mobile')
    expect(logout?.headers.authorization).toBe('Bearer access-1')
  })
})
