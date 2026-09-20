import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { allows, allowsTransition, usePermissions, visibleModules } from '@/permissions/usePermissions'
import { envelope, fakeServer, pendingServer } from '@/testing/fake-server'
import { matrix, user } from '@/testing/fixtures'

// Binds the session's refresh into the request layer.
import '@/auth/session'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

beforeEach(() => {
  queryClient.clear()
})

describe('reading the server permission matrix', () => {
  const siteEngineer = matrix('site_engineer', {
    rfi: { actions: ['read', 'create', 'submit'], transitions: ['rfi.submit'] },
    ncr: { actions: ['read', 'create'] },
    cost: { actions: ['read'], visible: false },
  })

  it('allows only what the matrix lists, and nothing on a hidden module', () => {
    expect(allows(siteEngineer, 'rfi', 'create')).toBe(true)
    expect(allows(siteEngineer, 'rfi', 'approve')).toBe(false)
    expect(allows(siteEngineer, 'ncr', 'approve')).toBe(false)
    expect(allows(siteEngineer, 'cost', 'read')).toBe(false)
    expect(allows(siteEngineer, 'inventory', 'read')).toBe(false)
    expect(allows(undefined, 'rfi', 'read')).toBe(false)
  })

  it('checks transitions the same way', () => {
    expect(allowsTransition(siteEngineer, 'rfi', 'rfi.submit')).toBe(true)
    expect(allowsTransition(siteEngineer, 'rfi', 'rfi.approve')).toBe(false)
  })

  it('lists the modules a person can see', () => {
    expect(visibleModules(siteEngineer)).toEqual(['rfi', 'ncr'])
  })
})

describe('the permissions hook', () => {
  it('answers from the shared policy until the server has spoken, then from the server only', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { ...user, role: 'warehouse' }, accessToken: 'access-1' })
    // The server says this warehouse person may raise RFIs on this project (a template widened it).
    // Held open: the server has the request but has not answered, so the first
    // two assertions describe the fallback rather than racing the reply.
    const { release } = pendingServer({ 'GET /auth/me/permissions': () => ({ status: 200, body: envelope(matrix('warehouse', { rfi: { actions: ['read', 'create'] } })) }) })

    const { result } = await renderHook(() => usePermissions('p1'), { wrapper })
    // Before the answer: the shared policy, where a warehouse role cannot create RFIs.
    expect(result.current.allows('rfi', 'create')).toBe(false)
    expect(result.current.allows('inventory', 'read')).toBe(true)

    release()
    await waitFor(() => expect(result.current.matrix).toBeDefined())
    expect(result.current.allows('rfi', 'create')).toBe(true)
    // The server answer is complete: a module it does not list is not allowed, whatever the policy says.
    expect(result.current.allows('inventory', 'read')).toBe(false)
  })

  it('keeps the matrix under the project key, so leaving the project drops it', async () => {
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1' })
    fakeServer({ 'GET /auth/me/permissions': () => ({ status: 200, body: envelope(matrix('pm', { rfi: { actions: ['read'] } })) }) })
    const { result } = await renderHook(() => usePermissions('p1'), { wrapper })
    await waitFor(() => expect(result.current.matrix).toBeDefined())
    expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined()
  })
})
