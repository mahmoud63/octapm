import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import ChangeOrderScreen from '../../../app/(app)/commercial/change-orders/[id]'
import CommitmentScreen from '../../../app/(app)/commercial/commitments/[id]'
import PayAppScreen from '../../../app/(app)/commercial/pay-apps/[id]'
import PayAppsScreen from '../../../app/(app)/commercial/pay-apps/index'
import type { ChangeOrder, PayApp } from '@/api/commercial-types'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { changeOrder, commitment, payApp, pmCommercial, subcontractorParty } from '@/testing/fixtures-commercial'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: PayApp

const serve = (permissions: PermissionMatrix = pmCommercial, options: { overClaim?: boolean } = {}) => {
  current = payApp()
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    // The register answers `{ orders, summary }`, as the live server does.
    'GET /projects/p1/change-orders': () => ({ status: 200, body: envelope({ orders: [changeOrder()], summary: { total: 1 } }) }),
    'GET /projects/p1/commitments/cm1': () => ({ status: 200, body: envelope(commitment()) }),
    'GET /projects/p1/pay-apps': () => ({ status: 200, body: envelope({ items: [current, payApp({ id: 'pa0', ref: 'SC-0001-PA03', periodLabel: 'August 2026', status: 'paid', paidAmount: 150000, outstanding: 0 })] }) }),
    'GET /projects/p1/pay-apps/pa1': () => ({ status: 200, body: envelope(current) }),
    'GET /projects/p1/comments': () => ({ status: 200, body: envelope({ items: [], pagination: { limit: 100, nextCursor: null } }) }),
    'GET /projects/p1/audit': () => ({ status: 200, body: envelope({ events: [], nextCursor: null }) }),
    'POST /projects/p1/pay-apps/pa1/submit': () => {
      if (options.overClaim) return { status: 400, body: { success: false, error: { code: 'SUB_PAY_APP_OVER_CLAIM', message: 'Claim exceeds approved progress', details: { lines: [{ lineNumber: 1, description: 'Formwork to columns and slabs', capAmount: 660000, approvedPct: 55 }] } } } }
      current = { ...current, status: 'submitted', submittedAt: '2026-09-18T10:00:00.000Z', ballInCourt: { state: 'awaiting', label: 'Awaiting the QS — review', party: { kind: 'role', label: 'The QS', role: 'qs' }, isYou: false, canAct: false, action: null } }
      return { status: 200, body: envelope(current) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'pa1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('change orders and commitments', () => {
  it('shows a change order with who holds it and offers no decision, even to the PM it waits on', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'co1' })
    await renderScreen(<ChangeOrderScreen />)
    expect(await screen.findByText('Second lift pit at grid F')).toBeTruthy()
    expect(screen.getByText('Awaiting the PM — approval')).toBeTruthy()
    expect(screen.getByText('Ten days on the substructure critical path')).toBeTruthy()
    expect(screen.queryByTestId('action-bar')).toBeNull()
    expect(screen.queryByText(/^Approve/)).toBeNull()
    expect(screen.getByTestId('change-order-web')).toBeTruthy()
  })

  // PC-7b / R5-5: the activities the order reaches, as the server composed them (relatedRecords).
  const serveOrder = (order: ChangeOrder) => {
    calls = fakeServer({
      'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmCommercial) }),
      'GET /projects/p1/change-orders': () => ({ status: 200, body: envelope({ orders: [order], summary: { total: 1 } }) }),
      'GET /projects/p1/comments': () => ({ status: 200, body: envelope({ items: [], pagination: { limit: 100, nextCursor: null } }) }),
      'GET /projects/p1/audit': () => ({ status: 200, body: envelope({ events: [], nextCursor: null }) }),
    })
  }
  const BOQ_REASON = 'The BOQ items a change order reaches through its allocations, and the activities reached only that way, are available only to members who may read the BOQ'
  const reaches = (activities: NonNullable<ChangeOrder['relatedRecords']>['activities']) => activities

  it('shows the activities the order reaches — direct, through an activity link and through an allocation, marked — each opening its activity', async () => {
    serveOrder(changeOrder({
      relatedRecords: {
        activities: reaches([
          { id: 'a1', code: 'A130', name: 'Foundation concrete', relation: 'direct', href: '/projects/p1/schedule/gantt?recordId=a1&source=activity' },
          { id: 'a2', code: 'A140', name: 'Ground beams', relation: 'activity_link', impactDays: 4, href: null },
          { id: 'a3', code: null, name: 'Lift pit walls', relation: 'via_allocation', href: null },
        ]),
        boqItems: [{ id: 'b1', code: '3.4', description: 'Lift pit concrete', unitCode: 'm3', relation: 'allocation_link', href: null }],
      },
    }))
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'co1' })
    await renderScreen(<ChangeOrderScreen />)
    expect(await screen.findByTestId('change-order-related-activity-a1')).toBeTruthy()
    expect(screen.getByText('A130 · Foundation concrete')).toBeTruthy()
    expect(screen.getByText('A140 · Ground beams')).toBeTruthy()
    expect(screen.getByText('Lift pit walls')).toBeTruthy()
    expect(screen.getByTestId('change-order-related-activity-a1-relation').props.children).toBe('Direct')
    expect(screen.getByTestId('change-order-related-activity-a2-relation').props.children).toBe('Activity link · 4 d')
    expect(screen.getByTestId('change-order-related-activity-a3-relation').props.children).toBe('Via a BOQ allocation')
    expect(screen.getByText('3.4 · Lift pit concrete')).toBeTruthy()
    expect(screen.queryByTestId('change-order-related-withheld')).toBeNull()
    expect(screen.queryByTestId('change-order-related-none')).toBeNull()
    await fireEvent.press(screen.getByTestId('change-order-related-activity-a3'))
    expect(useRouter().push).toHaveBeenCalledWith('/activities/a3')
  })

  it('for a member without BOQ read: every activity they may see stays, and what was withheld reads "—" with the reason, never "None"', async () => {
    serveOrder(changeOrder({
      relatedRecords: {
        activities: reaches([
          { id: 'a1', code: 'A130', name: 'Foundation concrete', relation: 'direct', href: null },
          { id: 'a2', code: 'A140', name: 'Ground beams', relation: 'activity_link', href: null },
        ]),
        boqWithheld: { keys: ['boqItems', 'activities.via_allocation'], reason: BOQ_REASON },
      },
    }))
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'co1' })
    await renderScreen(<ChangeOrderScreen />)
    expect(await screen.findByTestId('change-order-related-activity-a1')).toBeTruthy()
    expect(screen.getByTestId('change-order-related-activity-a2')).toBeTruthy()
    const withheld = screen.getByTestId('change-order-related-withheld')
    expect(withheld.props.children).toBe(`— ${BOQ_REASON}`)
    expect(screen.queryByTestId('change-order-related-none')).toBeNull()
    expect(screen.queryByTestId('change-order-related-boq')).toBeNull()
    expect(screen.queryByText(/Via a BOQ allocation/)).toBeNull()
  })

  it('an order that reaches nothing says None; one whose only activities were withheld says "—" with the reason', async () => {
    serveOrder(changeOrder({ activityId: null, activity: null, relatedRecords: { activities: [], boqItems: [] } }))
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'co1' })
    const first = await renderScreen(<ChangeOrderScreen />)
    expect(await screen.findByTestId('change-order-related-none')).toBeTruthy()
    await first.unmount()
    queryClient.clear()
    serveOrder(changeOrder({ activityId: null, activity: null, relatedRecords: { activities: [], boqWithheld: { keys: ['boqItems', 'activities.via_allocation'], reason: BOQ_REASON } } }))
    await renderScreen(<ChangeOrderScreen />)
    expect(await screen.findByTestId('change-order-related-withheld')).toBeTruthy()
    expect(screen.queryByTestId('change-order-related-none')).toBeNull()
  })

  it('shows a commitment with its money, its schedule of values and its change orders, read only', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'cm1' })
    await renderScreen(<CommitmentScreen />)
    expect(await screen.findByText('Reinforced concrete frame — labour and plant')).toBeTruthy()
    expect(screen.getByText('1. Formwork to columns and slabs')).toBeTruthy()
    expect(screen.getByText('SC-0001-CO-01 · Extra kicker to level 3')).toBeTruthy()
    expect(screen.getByText('Pending changes')).toBeTruthy()
    expect(screen.queryByTestId('action-bar')).toBeNull()
  })
})

describe('pay applications', () => {
  it('lists them and shows the draft to the PM without a submit', async () => {
    serve()
    await renderScreen(<PayAppsScreen />)
    expect(await screen.findByText('September 2026')).toBeTruthy()
    expect(screen.getByText('August 2026')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('pay-apps-chip-paid'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/pay-apps' && c.query.status === 'paid')).toBe(true))
  })

  it('offers the PM no submit, approve or pay on a draft', async () => {
    serve()
    await renderScreen(<PayAppScreen />)
    expect(await screen.findByText('September 2026')).toBeTruthy()
    expect(screen.getByText('1. Formwork to columns and slabs')).toBeTruthy()
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-submit')).toBeNull()
    expect(screen.queryByText(/Approve|Certify|Record payment/)).toBeNull()
  })

  it('lets the subcontractor party submit a draft through the submit route, and nothing more', async () => {
    serve(subcontractorParty)
    await renderScreen(<PayAppScreen />)
    await fireEvent.press(await screen.findByTestId('action-submit'))
    await fireEvent.press(await screen.findByTestId('prompt-submit-confirm'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/pa1/submit'))).toBe(true))
    expect(await screen.findByText('Awaiting the QS — review')).toBeTruthy()
    expect(screen.queryByTestId('action-submit')).toBeNull()
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/projects/p1/pay-apps/pa1/submit'])
  })

  it("shows the lines the server says are above approved progress when a submit is refused", async () => {
    serve(subcontractorParty, { overClaim: true })
    await renderScreen(<PayAppScreen />)
    await fireEvent.press(await screen.findByTestId('action-submit'))
    await fireEvent.press(await screen.findByTestId('prompt-submit-confirm'))
    expect(await screen.findByText('Above the approved progress')).toBeTruthy()
    expect(screen.getByText(/1\. Formwork to columns and slabs: cap/)).toBeTruthy()
    expect(screen.getByTestId('pay-app-failure').props.children).toMatch(/above the approved progress/)
  })
})
