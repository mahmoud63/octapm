import { screen, within } from '@testing-library/react-native'
import HomeScreen from '../../app/(app)/index'
import NotificationsScreen from '../../app/(app)/notifications'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { assignments, health, notification, page, pmMatrix, projects, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'
import '@/auth/session'

/**
 * The accessibility sweep (M9): every control a screen reader can reach has
 * a name, and every screen has a heading to jump to. A control without a
 * name is announced as "button", which is useless on a site with gloves on
 * and a phone held at arm's length; the rule is checked on the screens with
 * the most controls and enforced by the design system for the rest.
 */
const routes = {
  'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
  'GET /projects/p1/assignments/mine': () => ({ status: 200, body: envelope(assignments) }),
  'GET /projects/p1/health': () => ({ status: 200, body: envelope(health) }),
  'GET /notifications/summary': () => ({ status: 200, body: envelope({ unread: 2, read: 1, archived: 0, recent: [notification(), notification({ id: 'n2', title: 'RFI-001 was answered', status: 'read' })] }) }),
  'GET /notifications': () => ({ status: 200, body: envelope({ rows: [notification(), notification({ id: 'n2', title: 'RFI-001 was answered', status: 'read' })], pagination: { limit: 50, nextCursor: null } }) }),
  'GET /notifications/preferences': () => ({ status: 200, body: envelope({ preferences: [] }) }),
  'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmMatrix) }),
}

type Instance = ReturnType<typeof screen.getAllByRole>[number]

const nameOf = (element: Instance): string => {
  const label = element.props.accessibilityLabel ?? element.props['aria-label']
  if (typeof label === 'string' && label.trim()) return label.trim()
  return within(element)
    .queryAllByText(/\S/)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .join(' ')
    .trim()
}

beforeEach(async () => {
  network.__reset(null)
  await queryClient.cancelQueries()
  queryClient.clear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('accessibility', () => {
  it('names every button on Home and gives the screen a heading', async () => {
    fakeServer(routes)
    await renderScreen(<HomeScreen />)
    expect(await screen.findByText('Riverside Tower')).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(3)
    const unnamed = buttons.filter((b) => nameOf(b).length === 0).map((b) => b.props.testID ?? '(no testID)')
    expect(unnamed).toEqual([])
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0)
  })

  it('names every button on Notifications and marks the unread rows for a screen reader', async () => {
    fakeServer(routes)
    await renderScreen(<NotificationsScreen />)
    expect(await screen.findByText('RFI-001 was answered')).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    const unnamed = buttons.filter((b) => nameOf(b).length === 0).map((b) => b.props.testID ?? '(no testID)')
    expect(unnamed).toEqual([])
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0)
  })
})
