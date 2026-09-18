import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import ChangeOrderScreen from '../../../app/(app)/commercial/change-orders/[id]'
import CommitmentScreen from '../../../app/(app)/commercial/commitments/[id]'
import PayAppScreen from '../../../app/(app)/commercial/pay-apps/[id]'
import PayAppsScreen from '../../../app/(app)/commercial/pay-apps/index'
import type { PayApp } from '@/api/commercial-types'
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
