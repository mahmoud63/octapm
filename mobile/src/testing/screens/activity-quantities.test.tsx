import { screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import ActivityScreen, { progressSourceLine, quantityFigureLine } from '../../../app/(app)/activities/[id]'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { ActivityQuantities, QuantityProgressEntry } from '@/api/site-types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, failure, fakeServer, type Call, type Route } from '@/testing/fake-server'
import { health, page, projects, user } from '@/testing/fixtures'
import { activity, percentMethod, pmSite } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

/**
 * PC-6 on the activity screen: PROGRESS SOURCE for the official figure, the
 * count of quantities still waiting for the approvers, and the five
 * quantities with their truth — each the server's to give or withhold, and a
 * withheld one a dash with the reason, never a zero.
 */

let calls: Call[]

const pending: QuantityProgressEntry[] = [
  { id: 'qe1', activityId: 'a1', boqItemId: 'b1', unitCode: 'm3', quantity: 120, source: 'daily_log', status: 'submitted' },
  { id: 'qe2', activityId: 'a1', boqItemId: 'b2', unitCode: 'kg', quantity: 800, source: 'submission', status: 'submitted' },
]

const figures: ActivityQuantities = {
  received: { value: 500, truth: 'derived', basis: 'stock_receipts', unitCode: 'm3', unitMatch: true },
  issued: { value: 130, truth: 'derived', basis: 'stock_issues', unitCode: 'm3', unitMatch: false },
  installed: { value: 120, truth: 'derived', basis: 'approved_entries', unitCode: 'm3' },
  certified: { value: null, truth: 'source', basis: null, unitCode: 'm3', notAvailable: { reason: 'You do not have permission to read this section' } },
  paid: null,
  committed: { value: 480, truth: 'derived', basis: 'commitment_sov_lines', unitCode: 'm3' },
  notAvailable: { reason: 'Not available for a reader without the Cost module' },
}

const absent: Route = () => failure(404, 'NOT_FOUND', 'Not found')

const serve = (quantityRoutes: { pending?: Route; figures?: Route } = {}) =>
  (calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmSite) }),
    'GET /projects/p1/health': () => ({ status: 200, body: envelope(health) }),
    'GET /projects/p1/activities/a1': () => ({ status: 200, body: envelope(activity({ approvedProgressSource: 'daily_log', approvedProgressUpdatedAt: '2026-09-15T12:00:00.000Z' })) }),
    'GET /projects/p1/activities/a1/progress-method': () => ({ status: 200, body: envelope(percentMethod) }),
    'GET /projects/p1/activities/a1/progress-submissions': () => ({ status: 200, body: envelope([]) }),
    'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/rfis': () => ({ status: 200, body: envelope({ rows: [], total: 0 }) }),
    'GET /projects/p1/forms': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/lookaheads/constraints': () => ({ status: 200, body: envelope({ items: [], summary: { open: 0, overdue: 0, dueThisWeek: 0 } }) }),
    'GET /inventory/stock/movements': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/quantity-progress': quantityRoutes.pending ?? (() => ({ status: 200, body: envelope({ items: pending }) })),
    'GET /projects/p1/activities/a1/quantities': quantityRoutes.figures ?? (() => ({ status: 200, body: envelope(figures) })),
  }))

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'a1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('progress source and quantities on an activity', () => {
  it('names the source of the official figure, and says plainly when there is none', () => {
    expect(progressSourceLine({ pctComplete: 40, approvedProgressSource: 'daily_log', approvedProgressUpdatedAt: '2026-09-15T12:00:00.000Z' })).toBe('Progress source: Daily log · approved 15 Sep 2026')
    expect(progressSourceLine({ pctComplete: 40, approvedProgressSource: null, approvedProgressUpdatedAt: '2026-09-15T12:00:00.000Z' })).toBe('Progress source: Not recorded · approved 15 Sep 2026')
    // The server answers 0, not null, for an activity with no approved row; the stamp decides.
    expect(progressSourceLine({ pctComplete: 0, approvedProgressSource: null, approvedProgressUpdatedAt: null })).toMatch(/^No approved progress yet/)
    expect(progressSourceLine({ pctComplete: null, approvedProgressSource: null, approvedProgressUpdatedAt: null })).toMatch(/^No approved progress yet/)
    expect(progressSourceLine({ pctComplete: 0, approvedProgressSource: 'manual', approvedProgressUpdatedAt: '2026-09-15T12:00:00.000Z' })).toBe('Progress source: Manual · approved 15 Sep 2026')
  })

  it('prints a figure in its unit with its truth, and a dash with the reason for a withheld or missing one — never 0', () => {
    expect(quantityFigureLine(figures.installed, null)).toEqual({ value: '120 m3', detail: 'Derived · Approved entries' })
    expect(quantityFigureLine(figures.issued, null)).toEqual({ value: '130 m3', detail: 'Derived · Stock issues · unit differs from the item' })
    expect(quantityFigureLine(figures.certified, null)).toEqual({ value: '—', detail: 'You do not have permission to read this section' })
    expect(quantityFigureLine(null, figures.notAvailable)).toEqual({ value: '—', detail: 'Not available for a reader without the Cost module' })
    expect(quantityFigureLine(undefined, null)).toEqual({ value: '—', detail: 'Not available' })
    expect(quantityFigureLine({ value: 0, truth: 'derived', basis: 'approved_entries', unitCode: 'm3' }, null).value).toBe('0 m3')
  })

  it('shows PROGRESS SOURCE, counts the quantities awaiting approval and lists the five figures as the server gave them', async () => {
    serve()
    await renderScreen(<ActivityScreen />)
    expect(await screen.findByTestId('activity-progress-source')).toHaveTextContent(/Progress source: Daily log · approved 15 Sep 2026/)
    expect(await screen.findByTestId('activity-pending-quantities')).toHaveTextContent(/2 quantities awaiting approval/)
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/quantity-progress' && c.query.activityId === 'a1' && c.query.status === 'submitted')).toBe(true))

    const card = await screen.findByTestId('activity-quantities')
    expect(card).toBeTruthy()
    expect(screen.getByTestId('activity-quantity-installed')).toHaveTextContent(/120 m3/)
    expect(screen.getByTestId('activity-quantity-received')).toHaveTextContent(/500 m3/)
    expect(screen.getByTestId('activity-quantity-committed')).toHaveTextContent(/480 m3/)
    // Withheld: a dash and the server's reason, in place of the figure.
    expect(screen.getByTestId('activity-quantity-certified')).toHaveTextContent(/—/)
    expect(screen.getByTestId('activity-quantity-certified')).toHaveTextContent(/You do not have permission to read this section/)
    expect(screen.getByTestId('activity-quantity-certified')).not.toHaveTextContent(/0/)
    expect(screen.getByTestId('activity-quantity-paid')).toHaveTextContent(/—/)
    expect(screen.getByTestId('activity-quantity-paid')).toHaveTextContent(/Not available for a reader without the Cost module/)
  })

  it('leaves the count and the figures out on a server without the quantity register, and keeps the source line', async () => {
    serve({ pending: absent, figures: absent })
    await renderScreen(<ActivityScreen />)
    expect(await screen.findByTestId('activity-progress-source')).toHaveTextContent(/Progress source: Daily log/)
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/activities/a1/quantities')).toBe(true))
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'activity', 'a1', 'quantities'])).toBeNull())
    // Both answers are the explicit "no register" (null), not an error the screen would surface.
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'activity', 'a1', 'pending-quantities'])).toBeNull())
    expect(screen.queryByTestId('activity-failure')).toBeNull()
    expect(screen.queryByTestId('activity-pending-quantities')).toBeNull()
    expect(screen.queryByTestId('activity-quantities')).toBeNull()
  })
})
