import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { api, run } from '@/api/client'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { sessionReadiness, useAuthStore } from '@/auth/store'
import { usePermissions } from '@/permissions/usePermissions'
import { envelope, failure, fakeServer } from '@/testing/fake-server'
import { matrix, user } from '@/testing/fixtures'

// Binds the session's refresh into the request layer.
import '@/auth/session'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const permissionsRoute = { 'GET /auth/me/permissions': () => ({ status: 200, body: envelope(matrix('pm', { rfi: { actions: ['read'] } })) }) }

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

beforeEach(async () => {
  network.__reset(null)
  queryClient.clear()
  await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-1')
})

/**
 * A request sent before the session is in memory carries no bearer. The client
 * cannot tell that 401 from an expired token, so it refreshes, retries, is
 * refused a second time and ends the session — the person is thrown out of an
 * app they were already signed in to. These tests hold the line at the other
 * end: while the session is still being restored, nothing is asked for.
 */
describe('session readiness decides when a protected query may run', () => {
  it('names three states, so restoring is never mistaken for signed out', () => {
    expect(sessionReadiness('booting')).toBe('restoring')
    // A locked session is a real one behind a biometric prompt: not signed out,
    // and not something to send a request with either.
    expect(sessionReadiness('locked')).toBe('restoring')
    expect(sessionReadiness('signedIn')).toBe('authenticated')
    expect(sessionReadiness('signedOut')).toBe('unauthenticated')
  })

  it('asks for nothing while the session is still being restored', async () => {
    useAuthStore.setState({ status: 'booting', user: null, accessToken: null })
    const calls = fakeServer(permissionsRoute)
    const { result } = await renderHook(() => usePermissions('p1'), { wrapper })
    await settle()
    expect(calls).toHaveLength(0)
    expect(result.current.matrix).toBeUndefined()
  })

  it('asks for nothing when the person is signed out', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null, accessToken: null })
    const calls = fakeServer(permissionsRoute)
    await renderHook(() => usePermissions('p1'), { wrapper })
    await settle()
    expect(calls).toHaveLength(0)
  })

  it('asks as soon as the session arrives, without being remounted', async () => {
    useAuthStore.setState({ status: 'booting', user: null, accessToken: null })
    const calls = fakeServer(permissionsRoute)
    const { result } = await renderHook(() => usePermissions('p1'), { wrapper })
    expect(calls).toHaveLength(0)

    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1' })
    await waitFor(() => expect(result.current.matrix).toBeDefined())
    expect(calls).toHaveLength(1)
  })

  it('does not storm the refresh endpoint when a restore is in flight', async () => {
    useAuthStore.setState({ status: 'booting', user: null, accessToken: null })
    const calls = fakeServer(permissionsRoute)
    // Ten screens' worth of the same question, asked while the session restores.
    for (let i = 0; i < 10; i += 1) await renderHook(() => usePermissions('p1'), { wrapper })
    await settle()
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('stops asking the moment the person signs out, with the screen still mounted', async () => {
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1' })
    const calls = fakeServer(permissionsRoute)
    const { result } = await renderHook(() => usePermissions('p1'), { wrapper })
    await waitFor(() => expect(result.current.matrix).toBeDefined())
    const asked = calls.length

    // Sign out while the screen is still on screen: no further protected call,
    // and above all no refresh attempt with a token that is already gone.
    useAuthStore.setState({ status: 'signedOut', user: null, accessToken: null })
    void queryClient.invalidateQueries()
    await settle()
    expect(calls).toHaveLength(asked)
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(0)
  })

  it('still refreshes a genuinely expired session, which is the case the gate must not break', async () => {
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-stale', accessExpiresAt: Date.now() + 1000 })
    const calls = fakeServer({
      'GET /projects': (call) => (call.headers.authorization === 'Bearer access-new' ? { status: 200, body: envelope([]) } : failure(401, 'TOKEN_EXPIRED', 'expired')),
      'POST /auth/refresh': () => ({ status: 200, body: envelope({ user, tokens: { accessToken: 'access-new', expiresIn: 900, refreshToken: 'refresh-2', refreshTokenExpiresAt: '2030-01-01T00:00:00Z' } }) }),
    })
    await run(() => api.GET('/projects') as never)
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1)
  })

  it('lets a session opened offline keep trying, rather than calling it signed out', async () => {
    // Opening offline with a saved session is deliberate: the app enters
    // signedIn with an empty token and draws what it has cached. A request from
    // that state must not be refused here as though the person had signed out —
    // it goes to the server, and the refresh path decides what the session is.
    useAuthStore.setState({ status: 'signedIn', user, accessToken: '', accessExpiresAt: null })
    const calls = fakeServer({
      'GET /projects': () => ({ status: 200, body: envelope([]) }),
    })
    await run(() => api.GET('/projects') as never)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers.authorization).toBeUndefined()
  })

  it('does not refresh in a loop when the server refuses on the merits', async () => {
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 60_000 })
    const calls = fakeServer({
      'GET /projects/p1/cost': () => failure(403, 'FORBIDDEN', 'Your role cannot read cost'),
      'POST /auth/refresh': () => ({ status: 200, body: envelope({ user, tokens: { accessToken: 'access-2', expiresIn: 900, refreshToken: 'refresh-2', refreshTokenExpiresAt: '2030-01-01T00:00:00Z' } }) }),
    })
    await expect(run(() => api.GET('/projects/{projectId}/cost', { params: { path: { projectId: 'p1' } } }) as never)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // A 403 is an answer, not an expired token: it must never start a refresh.
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(0)
  })

  it('asks again for the project the person switched to, and not for the one they left', async () => {
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1' })
    const calls = fakeServer(permissionsRoute)
    const { result, rerender } = await renderHook(({ id }: { id: string }) => usePermissions(id), { wrapper, initialProps: { id: 'p1' } })
    await waitFor(() => expect(result.current.matrix).toBeDefined())
    expect(calls.map((c) => c.query.projectId)).toEqual(['p1'])

    rerender({ id: 'p2' })
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls.map((c) => c.query.projectId)).toEqual(['p1', 'p2'])
  })

  it('falls back to the shared policy, not to a locked screen, when the server refuses the matrix', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { ...user, role: 'site_engineer' }, accessToken: 'access-1' })
    fakeServer({ 'GET /auth/me/permissions': () => failure(403, 'FORBIDDEN', 'no access to this project') })
    const { result } = await renderHook(() => usePermissions('p1'), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    // The person is not stranded: the shared policy still answers for their role.
    expect(typeof result.current.allows('rfi', 'read')).toBe('boolean')
  })
})
