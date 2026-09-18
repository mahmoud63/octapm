import { api, run } from '@/api/client'
import { network } from '@/api/network'
import { forgetProject, keys, queryClient } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useAuthStore } from '@/auth/store'
import { deadNetwork, envelope, failure, fakeServer } from '@/testing/fake-server'

// Binding the session's refresh into the client happens when the session
// module loads; this import does that.
import '@/auth/session'

const user = { id: 'u1', orgId: 'o1', name: 'Dana Okafor', email: 'pm@octapm.demo', role: 'pm', isCompanyAdmin: true, status: 'active' }
const session = (suffix: string) =>
  envelope({ user, tokens: { accessToken: `access-${suffix}`, expiresIn: 900, refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-01-01T00:00:00Z' } })

beforeEach(async () => {
  network.__reset(null)
  queryClient.clear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-stale', accessExpiresAt: Date.now() + 1000, biometricEnabled: false, lastSignOutReason: null })
  await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-1')
})

describe('the request layer', () => {
  it('sends the bearer token, the client header and a request id on every call', async () => {
    const calls = fakeServer({ 'GET /projects': () => ({ status: 200, body: envelope([{ id: 'p1', name: 'Riverside Tower' }]) }) })
    const projects = await run(() => api.GET('/projects') as never)
    expect(projects).toEqual([{ id: 'p1', name: 'Riverside Tower' }])
    const call = calls[0]!
    expect(call.headers.authorization).toBe('Bearer access-stale')
    expect(call.headers['x-octapm-client']).toBe('mobile')
    expect(call.headers['x-request-id']).toMatch(/^[\w-]{8,}$/)
  })

  it('on a 401, refreshes once, retries once with the new token, and succeeds', async () => {
    let served = 0
    const calls = fakeServer({
      'GET /projects': (call) => {
        served += 1
        return call.headers.authorization === 'Bearer access-new' ? { status: 200, body: envelope([]) } : failure(401, 'TOKEN_EXPIRED', 'expired')
      },
      'POST /auth/refresh': () => ({ status: 200, body: session('new') }),
    })
    await expect(run(() => api.GET('/projects') as never)).resolves.toEqual([])
    expect(served).toBe(2)
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1)
    expect(useAuthStore.getState().accessToken).toBe('access-new')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-new')
  })

  it('refreshes once for many concurrent 401s', async () => {
    const calls = fakeServer({
      'GET /projects': (call) => (call.headers.authorization === 'Bearer access-new' ? { status: 200, body: envelope([]) } : failure(401, 'TOKEN_EXPIRED', 'expired')),
      'POST /auth/refresh': () => ({ status: 200, body: session('new') }),
    })
    await Promise.all(Array.from({ length: 8 }, () => run(() => api.GET('/projects') as never)))
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1)
  })

  it('ends the session when the refresh itself is refused, and clears the keychain and the cache', async () => {
    queryClient.setQueryData(keys.projects, [{ id: 'p1' }])
    fakeServer({
      'GET /projects': () => failure(401, 'TOKEN_EXPIRED', 'expired'),
      'POST /auth/refresh': () => failure(401, 'REFRESH_TOKEN_REUSED', 'replayed'),
    })
    await expect(run(() => api.GET('/projects') as never)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()
    expect(queryClient.getQueryData(keys.projects)).toBeUndefined()
  })

  it('treats a 403 as a refusal for this record, not as the end of the session', async () => {
    fakeServer({ 'GET /projects/other': () => failure(403, 'FORBIDDEN', 'Not on this project', 'req-403-1') })
    await expect(run(() => api.GET('/projects/other' as never) as never)).rejects.toMatchObject({ code: 'FORBIDDEN', requestId: 'req-403-1' })
    expect(useAuthStore.getState().status).toBe('signedIn')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-1')
  })

  it('carries the server request id from the header when the body has none', async () => {
    fakeServer({ 'GET /projects': () => ({ status: 500, body: { success: false, error: { code: 'BOOM', message: 'x' } }, headers: { 'X-Request-Id': 'hdr-77' } }) })
    await expect(run(() => api.GET('/projects') as never)).rejects.toMatchObject({ code: 'SERVER_ERROR', requestId: 'hdr-77' })
  })

  it('fails fast with OFFLINE when the device knows it has no connection, without touching the network', async () => {
    const calls = fakeServer({ 'GET /projects': () => ({ status: 200, body: envelope([]) }) })
    network.__reset(false)
    await expect(run(() => api.GET('/projects') as never)).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(calls).toHaveLength(0)
  })

  it('reports OFFLINE when the network is dead, and notes it', async () => {
    deadNetwork()
    await expect(run(() => api.GET('/projects') as never)).rejects.toMatchObject({ code: 'OFFLINE', retryable: true })
    expect(network.lastFailureAt()).toBeGreaterThan(0)
  })

  it('reports a cancelled request as CANCELLED, not as an outage', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw Object.assign(new Error('The user cancelled'), { name: 'AbortError' })
    }) as unknown as typeof fetch
    await expect(run(() => api.GET('/projects') as never)).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})

describe('project-scoped cache', () => {
  it('forgets everything about a project when it is left, and nothing about others', () => {
    queryClient.setQueryData(keys.projectScoped('p1', 'rfis'), [{ id: 'r1' }])
    queryClient.setQueryData(keys.needsYou('p1'), [{ id: 'n1' }])
    queryClient.setQueryData(keys.projectScoped('p2', 'rfis'), [{ id: 'r2' }])
    forgetProject('p1')
    expect(queryClient.getQueryData(keys.projectScoped('p1', 'rfis'))).toBeUndefined()
    expect(queryClient.getQueryData(keys.needsYou('p1'))).toBeUndefined()
    expect(queryClient.getQueryData(keys.projectScoped('p2', 'rfis'))).toEqual([{ id: 'r2' }])
  })
})
