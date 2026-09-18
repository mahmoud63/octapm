import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import ProcurementHomeScreen from '../../../app/(app)/procurement/index'
import LongLeadScreen from '../../../app/(app)/procurement/long-lead/index'
import OrderScreen from '../../../app/(app)/procurement/orders/[id]'
import OrdersScreen from '../../../app/(app)/procurement/orders/index'
import PackageScreen from '../../../app/(app)/procurement/packages/[id]'
import type { ProcurementOverview } from '@/api/commercial-types'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { longLead, overview, pmCommercial, registerOrder, siteEngineerCommercial } from '@/testing/fixtures-commercial'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: ProcurementOverview

const serve = (permissions: PermissionMatrix = pmCommercial) => {
  current = overview()
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/procurement': () => ({ status: 200, body: envelope(current) }),
    'PATCH /projects/p1/procurement/lead-time-alerts/al1': (call) => {
      const { status } = call.body as { status: string }
      current = { ...current, alerts: current.alerts.map((a) => (a.id === 'al1' ? { ...a, status, acknowledgedAt: '2026-09-18T10:00:00.000Z' } : a)), summary: { ...current.summary, openAlerts: 0, acknowledgedAlerts: 1 } }
      return { status: 200, body: envelope(current.alerts[0]) }
    },
    'GET /projects/p1/purchase-orders': (call) => ({ status: 200, body: envelope({ items: [registerOrder()].filter((o) => !call.query.status || o.status === call.query.status), summary: {} }) }),
    'GET /projects/p1/purchase-orders/po1': () => ({ status: 200, body: envelope(registerOrder()) }),
    'GET /projects/p1/long-lead': () => ({ status: 200, body: envelope(longLead) }),
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'po1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('procurement home', () => {
  it('shows the counts and the alerts, and acknowledges one through the legacy setter', async () => {
    serve()
    await renderScreen(<ProcurementHomeScreen />)
    expect(await screen.findByText('Missing delivery commitment')).toBeTruthy()
    expect(screen.getByText('Open alerts')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('alert-acknowledge-al1'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ status: 'acknowledged' })
    await waitFor(() => expect(screen.queryByTestId('alert-acknowledge-al1')).toBeNull())
    expect(await screen.findByText('Acknowledged')).toBeTruthy()
  })

  it('shows a site engineer the alerts without an acknowledge', async () => {
    serve(siteEngineerCommercial)
    await renderScreen(<ProcurementHomeScreen />)
    await screen.findByText('Missing delivery commitment')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('alert-acknowledge-al1')).toBeNull()
  })
})

describe('packages and orders', () => {
  it('shows a package with its dates, its alert and its order', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'pk1' })
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<PackageScreen />)
    expect(await screen.findByText('High-tensile reinforcement — foundations')).toBeTruthy()
    expect(screen.getByText('Missing delivery commitment')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('package-order-po1'))
    expect(router.push).toHaveBeenCalledWith('/procurement/orders/po1')
  })

  it('lists the register and lets the server filter by status', async () => {
    serve()
    await renderScreen(<OrdersScreen />)
    expect(await screen.findByText('High-tensile reinforcement — foundations')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('orders-chip-received'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/purchase-orders' && c.query.status === 'received')).toBe(true))
  })

  it('shows an issued order with its lines and offers a storekeeper the delivery, read only otherwise', async () => {
    serve()
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<OrderScreen />)
    expect(await screen.findByText('1. Reinforcement bar T16')).toBeTruthy()
    expect(screen.getByText('Awaiting the supplier — delivery')).toBeTruthy()
    expect(screen.getByText('Nothing received yet.')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('order-receive'))
    expect(router.push).toHaveBeenCalledWith('/inventory/receive/po1')
    expect(screen.queryByTestId('action-bar')).toBeNull()
  })

  it('hides the delivery from a role without stock receipt', async () => {
    serve(siteEngineerCommercial)
    await renderScreen(<OrderScreen />)
    await screen.findByText('1. Reinforcement bar T16')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('order-receive')).toBeNull()
  })
})

describe('long lead', () => {
  it('lists the items with when they must be ordered', async () => {
    serve()
    await renderScreen(<LongLeadScreen />)
    expect(await screen.findByText('Passenger lifts (2 no.)')).toBeTruthy()
    expect(screen.getByText('Curtain wall system')).toBeTruthy()
    expect(screen.getByText(/Order .*overdue/i)).toBeTruthy()
  })
})
