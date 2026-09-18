import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import ChangeEventScreen from '../../../app/(app)/commercial/change-events/[id]'
import ChangeEventsScreen from '../../../app/(app)/commercial/change-events/index'
import NewChangeEventScreen from '../../../app/(app)/commercial/change-events/new'
import CommercialHomeScreen from '../../../app/(app)/commercial/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { changeEvent, changeEventList, pmCommercial, siteEngineerCommercial, steps } from '@/testing/fixtures-commercial'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]

const serve = (permissions: PermissionMatrix = pmCommercial) => {
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/change-events': (call) => ({ status: 200, body: envelope(call.query.status === 'converted' ? changeEventList(changeEventList().items.filter((i) => i.status === 'converted')) : changeEventList()) }),
    'GET /projects/p1/change-events/ce1': () => ({ status: 200, body: envelope(changeEvent()) }),
    'GET /workflows/my-steps': () => ({ status: 200, body: envelope({ items: steps }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'GET /projects/p1/locations': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/comments': () => ({ status: 200, body: envelope({ items: [], pagination: { limit: 100, nextCursor: null } }) }),
    'GET /projects/p1/audit': () => ({ status: 200, body: envelope({ events: [], nextCursor: null }) }),
    'POST /projects/p1/change-events': (call) => {
      const body = call.body as Record<string, unknown>
      return { status: 201, body: envelope(changeEvent({ id: 'ce9', ref: 'CE-009', title: String(body.title), type: String(body.type), origin: String(body.origin), status: 'open', romAmount: Number(body.romAmount ?? 0), totals: { rom: Number(body.romAmount ?? 0), quoted: null, estimate: Number(body.romAmount ?? 0) }, lines: [], rfqs: [], rfqCounts: { total: 0, quoted: 0, accepted: 0, open: 0 } })) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'ce1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('commercial home', () => {
  it('shows the approvals waiting, the change-event totals and a door per module the role reads', async () => {
    serve()
    await renderScreen(<CommercialHomeScreen />)
    expect(await screen.findByText('Quotes waiting')).toBeTruthy()
    expect(screen.getByText('Approvals waiting on you')).toBeTruthy()
    for (const door of ['change-events', 'change-orders', 'commitments', 'pay-apps']) expect(screen.getByTestId(`commercial-${door}`)).toBeTruthy()
  })

  it('shows a site engineer the change-event door only', async () => {
    serve(siteEngineerCommercial)
    await renderScreen(<CommercialHomeScreen />)
    await screen.findByTestId('commercial-change-events')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('commercial-change-orders')).toBeNull()
    expect(screen.queryByTestId('commercial-pay-apps')).toBeNull()
  })
})

describe('change events', () => {
  it('lists them with the estimate and asks the server to filter by status', async () => {
    serve()
    await renderScreen(<ChangeEventsScreen />)
    expect(await screen.findByText('Rock at founding level, grid A-D')).toBeTruthy()
    expect(screen.getByText('Client asked for a second lift pit')).toBeTruthy()
    expect(screen.getByTestId('change-event-new')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('change-events-chip-converted'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/change-events' && c.query.status === 'converted')).toBe(true))
    await waitFor(() => expect(screen.queryByText('Rock at founding level, grid A-D')).toBeNull())
  })

  it('raises one with its kind, origin, rough order of magnitude and days, then opens it', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ origin: 'daily_log', sourceRecordType: 'daily_log', sourceRecordId: '2026-09-18' })
    const router = useRouter() as unknown as { replace: jest.Mock }
    await renderScreen(<NewChangeEventScreen />)
    expect((await screen.findByTestId('change-event-raise')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('change-event-title'), 'Water table higher than the borehole showed')
    await fireEvent.press(screen.getByTestId('change-event-type-site_condition'))
    await fireEvent.changeText(screen.getByTestId('change-event-rom'), '12000')
    await fireEvent.changeText(screen.getByTestId('change-event-days'), '3')
    await fireEvent.press(screen.getByTestId('change-event-raise'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ title: 'Water table higher than the borehole showed', type: 'site_condition', origin: 'daily_log', romAmount: 12000, scheduleImpactDays: 3, ownerChange: false, sourceRecordType: 'daily_log', sourceRecordId: '2026-09-18' })
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/commercial/change-events/ce9'))
  })

  it('shows the estimate, the lines, the quotes and hands pricing to the web', async () => {
    serve()
    await renderScreen(<ChangeEventScreen />)
    expect(await screen.findByText('Rock at founding level, grid A-D')).toBeTruthy()
    expect(screen.getByText('Break out rock and cart away')).toBeTruthy()
    expect(screen.getByText('Delta Groundworks')).toBeTruthy()
    expect(screen.getByText('Apex Civils')).toBeTruthy()
    expect(screen.getByTestId('change-event-web')).toBeTruthy()
    // Nothing on this screen accepts a quote, converts, closes or voids.
    expect(screen.queryByTestId('action-bar')).toBeNull()
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
})
