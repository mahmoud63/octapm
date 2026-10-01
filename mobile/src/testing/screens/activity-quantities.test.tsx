import { screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import ActivityScreen, { officialInstalledLine, progressSourceLine, quantityFigureLine } from '../../../app/(app)/activities/[id]'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { readActivityQuantities } from '@/api/site-endpoints'
import type { ActivityQuantitiesAnswer, QuantityFigure, QuantityProgressEntry } from '@/api/site-types'
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

/** The six figures as the views server folds them for an activity (quantity-views.service getActivityQuantities): nested under `figures`, never at the top level. */
const figures: Record<string, QuantityFigure | null> = {
  // A genuine zero — nothing received against the activity — is a figure, not a withheld one.
  received: { value: 0, truth: 'derived', basis: 'stock_receipts', unitCode: 'm3', unitMatch: true },
  issued: { value: 130, truth: 'derived', basis: 'stock_issues', unitCode: 'm3', unitMatch: false },
  installed: { value: 120, truth: 'derived', basis: 'approved_entries', unitCode: 'm3' },
  certified: { value: null, truth: 'source', basis: null, unitCode: 'm3', notAvailable: { reason: 'You do not have permission to read the ipc module, which owns this figure' } },
  paid: null,
  committed: { value: 480, truth: 'derived', basis: 'commitment_sov_lines', unitCode: 'm3' },
}

const identity = { kind: 'activity', id: 'a1', activityId: 'a1', code: 'Q100', name: 'Blockwork', cutoffDate: null, asOf: '2026-09-30T00:00:00.000Z', core: 'present', keys: ['received', 'issued', 'installed', 'certified', 'paid', 'committed'] }

/** The answer for a member who may read the BOQ: identity, progress and the figures, with the reasons per figure. */
const answer: ActivityQuantitiesAnswer = {
  ...identity,
  progress: { allowed: true, method: 'quantity', pctComplete: { value: 40, truth: 'source', basis: 'Latest approved ActivityProgress' }, progressSource: 'daily_log', planned: { value: 480, truth: 'source', basis: 'approved_allocations', unitCode: 'm3' } },
  figures,
  comparisons: {},
  items: [],
}

/**
 * The answer for a member the server withholds the bill from
 * (utils/boq-figures withheldActivityQuantities): the identity and the
 * progress section stay, `withheld` and the reason sit at the top, and every
 * figure is there but withheld with the same reason — never a zero.
 */
const BOQ_WITHHELD = "Installed, certified, paid, received, issued and committed quantities are worked from the BOQ's rows, available only to members who may read the BOQ"
const withheldFigure: QuantityFigure = { value: null, truth: null, basis: BOQ_WITHHELD, unitCode: null, unitMatch: null, withheld: true, notAvailable: { reason: BOQ_WITHHELD } }
const withheldAnswer: ActivityQuantitiesAnswer = {
  ...identity,
  withheld: true,
  reason: BOQ_WITHHELD,
  progress: { allowed: true, method: 'quantity', pctComplete: { value: 40, truth: 'source', basis: 'Latest approved ActivityProgress' }, progressSource: 'daily_log', planned: withheldFigure },
  figures: { received: withheldFigure, issued: withheldFigure, installed: withheldFigure, certified: withheldFigure, paid: withheldFigure, committed: withheldFigure },
  comparisons: {},
  items: [],
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
    'GET /projects/p1/activities/a1/quantities': quantityRoutes.figures ?? (() => ({ status: 200, body: envelope(answer) })),
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
    expect(quantityFigureLine(figures.certified, null)).toEqual({ value: '—', detail: 'You do not have permission to read the ipc module, which owns this figure' })
    expect(quantityFigureLine(null, { reason: 'Not available for a reader without the Cost module' })).toEqual({ value: '—', detail: 'Not available for a reader without the Cost module' })
    expect(quantityFigureLine(withheldFigure, { reason: BOQ_WITHHELD })).toEqual({ value: '—', detail: BOQ_WITHHELD })
    expect(quantityFigureLine(undefined, null)).toEqual({ value: '—', detail: 'Not available' })
    expect(quantityFigureLine({ value: 0, truth: 'derived', basis: 'approved_entries', unitCode: 'm3' }, null).value).toBe('0 m3')
  })

  it('reads the figures from where the views server puts them — nested under `figures` — and the withholding from the top of the answer', () => {
    const read = readActivityQuantities(answer)
    expect(read.received).toEqual(figures.received)
    expect(read.installed).toEqual(figures.installed)
    expect(read.certified?.notAvailable?.reason).toBe('You do not have permission to read the ipc module, which owns this figure')
    expect(read.committed?.value).toBe(480)
    expect(read.notAvailable).toBeNull()
    expect(read.progressSource).toBe('daily_log')

    const withheld = readActivityQuantities(withheldAnswer)
    expect(withheld.notAvailable).toEqual({ reason: BOQ_WITHHELD })
    expect(withheld.installed?.value).toBeNull()
    expect(withheld.installed?.notAvailable?.reason).toBe(BOQ_WITHHELD)

    // A server answer without the figures block at all: nothing is invented, and nothing is called 0.
    const bare = readActivityQuantities({ ...identity, progress: { allowed: false, module: 'progress', reason: 'You do not have permission to read this section' } })
    expect(bare.installed).toBeUndefined()
    expect(bare.notAvailable).toBeNull()
    expect(bare.progressSource).toBeNull()
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
    // A real zero is printed as a figure in its unit, not hidden behind a dash.
    expect(screen.getByTestId('activity-quantity-received')).toHaveTextContent(/0 m3/)
    expect(screen.getByTestId('activity-quantity-received')).not.toHaveTextContent(/—|Not available/)
    expect(screen.getByTestId('activity-quantity-committed')).toHaveTextContent(/480 m3/)
    // Withheld: a dash and the server's own reason, in place of the figure — never the app's substitute.
    expect(screen.getByTestId('activity-quantity-certified')).toHaveTextContent(/—/)
    expect(screen.getByTestId('activity-quantity-certified')).toHaveTextContent(/You do not have permission to read the ipc module, which owns this figure/)
    expect(screen.getByTestId('activity-quantity-certified')).not.toHaveTextContent(/0/)
    expect(screen.getByTestId('activity-quantity-paid')).toHaveTextContent(/—/)
    expect(screen.getByTestId('activity-quantity-paid')).toHaveTextContent(/Not available/)
  })

  it('prints the official installed figure beside the installed one when the server states a legacy floor — both figures, the reason, no sum', async () => {
    const OFFICIAL_BASIS = 'official figure of the latest approved progress, carrying a legacy typed quantity as its floor'
    const floored: QuantityFigure = { value: 15, truth: 'derived', basis: 'approved_entries', unitCode: 'm3', officialInstalled: { value: 75, unitCode: 'm3', basis: OFFICIAL_BASIS } }
    expect(officialInstalledLine(floored)).toBe(`Official installed: 75 m3 — ${OFFICIAL_BASIS}. The approved entries add up to less because earlier progress was typed, not entered.`)
    // The installed figure itself is what it was.
    expect(quantityFigureLine(floored, null).value).toBe('15 m3')
    // No floor stated, a withheld figure, no figure: nothing is printed.
    expect(officialInstalledLine(figures.installed)).toBeNull()
    expect(officialInstalledLine(withheldFigure)).toBeNull()
    expect(officialInstalledLine({ ...floored, officialInstalled: { value: null } })).toBeNull()
    expect(officialInstalledLine(null)).toBeNull()

    serve({ figures: () => ({ status: 200, body: envelope({ ...answer, figures: { ...figures, installed: floored } }) }) })
    await renderScreen(<ActivityScreen />)
    await screen.findByTestId('activity-quantities')
    expect(screen.getByTestId('activity-quantity-installed')).toHaveTextContent(/15 m3/)
    expect(screen.getByTestId('activity-quantity-installed-official')).toHaveTextContent(/Official installed: 75 m3 — official figure of the latest approved progress, carrying a legacy typed quantity as its floor\. The approved entries add up to less because earlier progress was typed, not entered\./)
    expect(screen.getByTestId('activity-quantity-installed')).not.toHaveTextContent(/\b90\b/)
  })

  it('prints no official installed figure when the server states none, or withholds the bill', async () => {
    serve()
    await renderScreen(<ActivityScreen />)
    await screen.findByTestId('activity-quantities')
    expect(screen.getByTestId('activity-quantity-installed')).toHaveTextContent(/120 m3/)
    expect(screen.queryByTestId('activity-quantity-installed-official')).toBeNull()
  })

  it("shows a dash and the server's reason on every figure for a member the server withholds the bill from — never a zero", async () => {
    serve({ figures: () => ({ status: 200, body: envelope(withheldAnswer) }) })
    await renderScreen(<ActivityScreen />)
    await screen.findByTestId('activity-quantities')
    for (const key of ['received', 'issued', 'installed', 'certified', 'paid', 'committed']) {
      const line = screen.getByTestId(`activity-quantity-${key}`)
      expect(line).toHaveTextContent(/—/)
      expect(line).toHaveTextContent(/available only to members who may read the BOQ/)
      expect(line).not.toHaveTextContent(/\b0\b/)
    }
    expect(screen.queryByTestId('activity-quantity-installed-official')).toBeNull()
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
