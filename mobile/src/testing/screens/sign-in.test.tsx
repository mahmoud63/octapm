import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'
import SignInScreen from '../../../app/(auth)/sign-in'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useAuthStore } from '@/auth/store'
import { envelope, failure, fakeServer } from '@/testing/fake-server'

// Binds the session's refresh into the request layer.
import '@/auth/session'

const user = { id: 'u1', orgId: 'o1', name: 'Dana Okafor', email: 'pm@octapm.demo', role: 'pm', isCompanyAdmin: true, status: 'active' }
const signedOut = (reason: 'user' | 'expired' | 'revoked' | null = null) =>
  useAuthStore.setState({ status: 'signedOut', user: null, accessToken: null, accessExpiresAt: null, biometricEnabled: false, lastSignOutReason: reason })

const fillAndSubmit = async () => {
  await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'pm@octapm.demo')
  await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'DemoPassw0rd!')
  await fireEvent.press(screen.getByTestId('sign-in-submit'))
}

const errorText = async () => String((await screen.findByTestId('sign-in-error')).props.children)

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  signedOut()
})

describe('the sign-in screen', () => {
  it('tells a person whose session expired why they are here', async () => {
    signedOut('expired')
    await render(<SignInScreen />)
    expect(screen.getByText('Your session ended. Sign in again to continue.')).toBeTruthy()
  })

  it('tells a person whose access was revoked why they are here', async () => {
    signedOut('revoked')
    await render(<SignInScreen />)
    expect(screen.getByText('Your access was changed by an administrator. Sign in again.')).toBeTruthy()
  })

  it('says nothing about a previous session after a deliberate sign-out', async () => {
    signedOut('user')
    await render(<SignInScreen />)
    expect(screen.queryByText(/session ended|administrator/)).toBeNull()
  })

  it('turns a wrong password (401) into a sentence and stays signed out with an empty keychain', async () => {
    fakeServer({ 'POST /auth/login': () => failure(401, 'INVALID_CREDENTIALS', 'Invalid credentials', 'req-401-9') })
    await render(<SignInScreen />)
    await fillAndSubmit()
    const text = await errorText()
    expect(text).not.toMatch(/INVALID_CREDENTIALS|Error:|stack/i)
    expect(text.length).toBeGreaterThan(10)
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()
  })

  it('turns a disabled account (403) into a sentence, not a code', async () => {
    fakeServer({ 'POST /auth/login': () => failure(403, 'USER_INACTIVE', 'User inactive', 'req-403-9') })
    await render(<SignInScreen />)
    await fillAndSubmit()
    expect(await errorText()).not.toMatch(/USER_INACTIVE/)
    expect(useAuthStore.getState().status).toBe('signedOut')
  })

  it('says the device is offline and sends nothing when there is no connection', async () => {
    const calls = fakeServer({ 'POST /auth/login': () => ({ status: 200, body: envelope({}) }) })
    network.__reset(false)
    await render(<SignInScreen />)
    await fillAndSubmit()
    expect(await errorText()).toMatch(/offline|connection/i)
    expect(calls).toHaveLength(0)
  })

  it('signs in through the native contract: access token in memory only, refresh token in the keychain', async () => {
    const calls = fakeServer({
      'POST /auth/login': () => ({
        status: 200,
        body: envelope({ user, tokens: { accessToken: 'access-live-1', tokenType: 'Bearer', expiresIn: 900, refreshToken: 'refresh-live-1', refreshTokenExpiresAt: '2030-01-01T00:00:00Z' } }),
      }),
    })
    await render(<SignInScreen />)
    await fillAndSubmit()
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedIn'))

    expect(calls[0]!.headers['x-octapm-client']).toBe('mobile')
    expect(calls[0]!.body).toMatchObject({ email: 'pm@octapm.demo', password: 'DemoPassw0rd!' })
    expect(useAuthStore.getState().accessToken).toBe('access-live-1')
    expect(useAuthStore.getState().user?.name).toBe('Dana Okafor')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-live-1')

    // Only the refresh token and the remembered email ever reach the keychain.
    const stored = (SecureStore.setItemAsync as jest.Mock).mock.calls.map((call) => String(call[1]))
    expect(stored).toContain('refresh-live-1')
    expect(stored.some((value) => value.includes('access-'))).toBe(false)
  })
})
