import { render, screen } from '@testing-library/react-native'
import AppLayout from '../../../app/(app)/_layout'
import AuthLayout from '../../../app/(auth)/_layout'
import { useAuthStore } from '@/auth/store'

const user = { id: 'u1', orgId: 'o1', name: 'Dana Okafor', email: 'pm@octapm.demo', role: 'pm', isCompanyAdmin: true, status: 'active' }
const setStatus = (status: 'booting' | 'signedOut' | 'locked' | 'signedIn') =>
  useAuthStore.setState({ status, user: status === 'signedIn' ? user : null, accessToken: status === 'signedIn' ? 'access-1' : null })

describe('the signed-in shell', () => {
  it('sends a signed-out person to sign in', async () => {
    setStatus('signedOut')
    await render(<AppLayout />)
    expect(screen.getByTestId('redirect').props.children).toBe('/sign-in')
  })

  it('sends a locked person to sign in, where biometric unlock is offered', async () => {
    setStatus('locked')
    await render(<AppLayout />)
    expect(screen.getByTestId('redirect').props.children).toBe('/sign-in')
  })

  it('shows nothing while the saved session is still being checked', async () => {
    setStatus('booting')
    const { toJSON } = await render(<AppLayout />)
    expect(toJSON()).toBeNull()
  })

  it('declares the same five destinations for everyone who is signed in', async () => {
    setStatus('signedIn')
    await render(<AppLayout />)
    for (const name of ['index', 'projects', 'needs-you', 'search', 'more']) expect(screen.getByTestId(`route-${name}`)).toBeTruthy()
    expect(screen.queryByTestId('redirect')).toBeNull()
  })
})

describe('the signed-out stack', () => {
  it('keeps a signed-in person out of the sign-in screens', async () => {
    setStatus('signedIn')
    await render(<AuthLayout />)
    expect(screen.getByTestId('redirect').props.children).toBe('/')
  })

  it('shows the sign-in stack to everyone else', async () => {
    setStatus('signedOut')
    await render(<AuthLayout />)
    expect(screen.getByTestId('navigator')).toBeTruthy()
  })
})
