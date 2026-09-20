import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import MoreScreen from '../../../app/(app)/more'
import { network } from '@/api/network'
import { keys, queryClient } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useAuthStore } from '@/auth/store'
import { deadNetwork, envelope, fakeServer } from '@/testing/fake-server'

// Binds the session's refresh into the request layer.
import { renderScreen as render } from '@/testing/render'

import '@/auth/session'

const user = { id: 'u1', orgId: 'o1', name: 'Dana Okafor', email: 'pm@octapm.demo', role: 'pm', isCompanyAdmin: true, status: 'active' }

beforeEach(async () => {
  network.__reset(null)
  queryClient.clear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000, biometricEnabled: false, lastSignOutReason: null })
  await secureStorage.set(STORAGE_KEYS.refreshToken, 'refresh-1')
  await secureStorage.set(STORAGE_KEYS.profile, JSON.stringify(user))
  queryClient.setQueryData(keys.projects, [{ id: 'p1' }])
})

describe('the More screen', () => {
  it('shows who is signed in and which build this is', async () => {
    await render(<MoreScreen />)
    expect(screen.getByText('Dana Okafor')).toBeTruthy()
    expect(screen.getByText('pm@octapm.demo')).toBeTruthy()
    expect(screen.getByText('Project Manager')).toBeTruthy()
  })

  it('signs out: tells the server which session to revoke, then clears the keychain, the profile and the cache', async () => {
    const calls = fakeServer({ 'POST /auth/logout': () => ({ status: 200, body: envelope({ revoked: true }) }) })
    await render(<MoreScreen />)
    await fireEvent.press(screen.getByTestId('sign-out'))
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedOut'))

    const logout = calls.find((c) => c.path === '/auth/logout')!
    expect(logout.body).toEqual({ refreshToken: 'refresh-1' })
    expect(logout.headers['x-octapm-client']).toBe('mobile')
    expect(logout.headers.authorization).toBe('Bearer access-1')
    expect(useAuthStore.getState().lastSignOutReason).toBe('user')
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.profile)).toBeNull()
    expect(queryClient.getQueryData(keys.projects)).toBeUndefined()
  })

  it('still ends the session locally when the server cannot be reached', async () => {
    deadNetwork()
    await render(<MoreScreen />)
    await fireEvent.press(screen.getByTestId('sign-out'))
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedOut'))
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()
  })
})
