import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { bootstrap } from '@/auth/session'
import { useAuthStore } from '@/auth/store'
import { deadNetwork, envelope, fakeServer } from '@/testing/fake-server'

const user = { id: 'u1', orgId: 'o1', name: 'Dana Okafor', email: 'pm@octapm.demo', role: 'pm', isCompanyAdmin: true, status: 'active' }

beforeEach(async () => {
  network.__reset(null)
  queryClient.clear()
  useAuthStore.setState({ status: 'booting', user: null, accessToken: null, accessExpiresAt: null, biometricEnabled: false, lastSignOutReason: null })
  await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-saved')
})

describe('starting the app without a connection', () => {
  it('opens with the last known person and keeps the saved token for when the network returns', async () => {
    await secureStorage.set(STORAGE_KEYS.profile, JSON.stringify(user))
    deadNetwork()
    await bootstrap()
    const state = useAuthStore.getState()
    expect(state.status).toBe('signedIn')
    expect(state.user?.name).toBe('Dana Okafor')
    expect(state.accessToken).toBeFalsy()
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-saved')
  })

  it('asks for a sign-in, without blaming the session, when nothing is known about the person yet', async () => {
    deadNetwork()
    await bootstrap()
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().lastSignOutReason).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-saved')
  })

  it('still ends the session, and forgets the person, when the server refuses the saved token', async () => {
    await secureStorage.set(STORAGE_KEYS.profile, JSON.stringify(user))
    fakeServer({ 'POST /auth/refresh': () => ({ status: 401, body: { success: false, error: { code: 'REFRESH_TOKEN_REUSED', message: 'replayed' } } }) })
    await bootstrap()
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().lastSignOutReason).toBe('expired')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.profile)).toBeNull()
  })

  it('remembers the person after a successful resume, for the next offline start', async () => {
    fakeServer({
      'POST /auth/refresh': () => ({ status: 200, body: envelope({ user, tokens: { accessToken: 'access-2', expiresIn: 900, refreshToken: 'refresh-2' } }) }),
      'GET /auth/me': () => ({ status: 200, body: envelope(user) }),
    })
    await bootstrap()
    expect(useAuthStore.getState().status).toBe('signedIn')
    expect(JSON.parse((await secureStorage.get(STORAGE_KEYS.profile)) ?? '{}').name).toBe('Dana Okafor')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-2')
  })
})
