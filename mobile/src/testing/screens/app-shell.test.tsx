import { screen } from '@testing-library/react-native'
import AppLayout from '../../../app/(app)/_layout'
import AuthLayout from '../../../app/(auth)/_layout'
import { useAuthStore } from '@/auth/store'
import { renderScreen as render } from '@/testing/render'

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

  it('gives a project manager the destinations of their job', async () => {
    setStatus('signedIn')
    await render(<AppLayout />)
    for (const name of ['index', 'needs-you', 'project', 'controls', 'more']) expect(screen.getByTestId(`route-${name}`)).toBeTruthy()
    expect(screen.queryByTestId('redirect')).toBeNull()
  })

  it('keeps every other destination routable, off the bar', async () => {
    setStatus('signedIn')
    await render(<AppLayout />)
    // A link, a notification tap or a search result must still reach these.
    for (const name of ['rfi', 'quality', 'inventory', 'site', 'drawings', 'photos', 'workflow', 'search', 'projects']) {
      expect(screen.getByTestId(`route-${name}`)).toBeTruthy()
    }
  })

  it('declares each destination exactly once', async () => {
    setStatus('signedIn')
    await render(<AppLayout />)
    const ids = screen.getAllByTestId(/^route-/).map((node) => node.props.testID)
    expect(new Set(ids).size).toBe(ids.length)
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
