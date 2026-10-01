import { fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import DailyLogScreen, { describeEntry, quantityStanding } from '../../../app/(app)/site/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { DailyLog, DailyLogEntry } from '@/api/site-types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, failure, fakeServer, type Call, type Route } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { activities, allocationsOfA1, emptyLog, financeSite, pmSite, quantityEntry, siteEngineerSite, today } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

/**
 * PC-6, the daily log's seventh section: a quantity installed against an
 * allocated BOQ item. What the phone records is a line of the day that the
 * server turns into a *pending* progress entry; the app must never show it
 * as official, must take the item from the server's own list (and show a
 * dash with the server's reason when the bill is withheld), must refuse a
 * negative quantity, and must offer no form to a member who may not submit
 * progress. Role controls presentation, permission controls authorisation.
 */

let calls: Call[]
let current: DailyLog

/** A day whose server keeps the quantities section (the answer carries the key). */
const dayWithQuantities = (entries: DailyLogEntry[] = []) => emptyLog(today, { id: 'log1', exists: true, sections: { ...emptyLog().sections, quantities: entries } })

const serve = (permissions = siteEngineerSite, log = dayWithQuantities(), allocations: Route = () => ({ status: 200, body: envelope(allocationsOfA1) })) => {
  current = log
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/daily-logs/settings': () => ({ status: 200, body: envelope({ weatherFeedEnabled: false, weatherFeedAvailable: false, hasCoordinates: false, copySections: [] }) }),
    [`GET /projects/p1/daily-logs/${today}`]: () => ({ status: 200, body: envelope(current) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'GET /projects/p1/locations': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/activity-boq-allocations': allocations,
    'GET /projects/p1/activities/progress-submissions': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/lookaheads/constraints': () => ({ status: 200, body: envelope({ items: [], summary: { open: 0, overdue: 0, dueThisWeek: 0 } }) }),
    [`POST /projects/p1/daily-logs/${today}/entries/quantities`]: (call) => {
      const body = call.body as Record<string, unknown>
      const entry = quantityEntry({ id: 'q9', clientRequestId: String(body.clientRequestId), quantity: Number(body.quantity), unitCode: String(body.unitCode), boqItemId: String(body.boqItemId), activityId: String(body.activityId) })
      current = { ...current, sections: { ...current.sections, quantities: [...(current.sections.quantities ?? []), entry] }, totals: { ...current.totals, entries: current.totals.entries + 1 } }
      return { status: 201, body: envelope(current) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('quantities installed on the daily log', () => {
  it('describes a quantity line as pending with its source, never as official — whatever the row’s own status says', () => {
    expect(describeEntry('quantities', quantityEntry())).toBe('120 m3 · Concrete C30 to raft — awaiting approval · source daily log')
    // The section row is "approved" the moment a staff member adds it; that is the day's review state, not progress.
    expect(quantityStanding(quantityEntry({ status: 'approved', progressEntry: null }))).toBe('awaiting approval · source daily log')
    expect(quantityStanding(quantityEntry({ progressEntry: { status: 'approved', source: 'daily_log' } }))).toBe('approved as progress · source daily log')
    expect(quantityStanding(quantityEntry({ progressEntry: { status: 'rejected', source: 'daily_log' } }))).toBe('rejected · source daily log')
    // A Decimal(18,3) serialised as a string still reads as a number.
    expect(describeEntry('quantities', quantityEntry({ quantity: '25.000' as unknown as number }))).toBe('25 m3 · Concrete C30 to raft — awaiting approval · source daily log')
    // A withheld item is a dash, not a name and not a figure.
    expect(describeEntry('quantities', quantityEntry({ boqItem: null, boqWithheld: { reason: 'You do not have permission to read this section' } }))).toBe('120 m3 · — — awaiting approval · source daily log')
    // The server withholds the quantity itself from a reader without the BOQ (the ledger's rule): a dash with the reason, the description kept, never a zero.
    const withheld = quantityEntry({ quantity: undefined, unitCode: undefined, boqItem: { description: 'Concrete C30 to raft', unit: 'm3' }, boqWithheld: { keys: ['quantity', 'unitCode', 'boqItemId', 'allocationId', 'boqItem.id', 'boqItem.code'], reason: 'BOQ figures withheld' } })
    expect(describeEntry('quantities', withheld)).toBe('— (BOQ figures withheld) · Concrete C30 to raft — awaiting approval · source daily log')
    expect(describeEntry('quantities', withheld)).not.toMatch(/^0\b|\b120\b/)
  })

  it('records a quantity against an allocated item from the server’s list, with the item’s unit and a replay key', async () => {
    serve()
    await renderScreen(<DailyLogScreen />)
    await fireEvent.press(await screen.findByTestId('daily-log-add-quantities'))
    expect(await screen.findByTestId('entry-quantities-note')).toBeTruthy()
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).toBe(true)

    // The activity first; the items are its approved allocations.
    await fireEvent.press(screen.getByTestId('entry-activity'))
    await fireEvent.press(await screen.findByTestId('entry-activity-option-a1'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/activity-boq-allocations' && c.query.activityId === 'a1' && c.query.status === 'approved')).toBe(true))
    await fireEvent.press(screen.getByTestId('entry-item'))
    // Description and unit; the code only where the server sent one.
    expect(await screen.findByText('C-030 · m3')).toBeTruthy()
    expect(screen.getByText('kg')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('entry-item-option-b1'))
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).toBe(true)

    await fireEvent.changeText(screen.getByTestId('entry-quantity'), '120')
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).toBe(false)
    await fireEvent.press(screen.getByTestId('entry-save'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/entries/quantities'))).toBe(true))
    const sent = calls.find((c) => c.path.endsWith('/entries/quantities'))!.body as Record<string, unknown>
    expect(sent).toMatchObject({ activityId: 'a1', boqItemId: 'b1', allocationId: 'al1', unitCode: 'm3', quantity: 120 })
    expect(String(sent.clientRequestId)).toMatch(/[0-9a-f-]{20,}/)

    // Back on the day: pending, with its source, and never the row's "Approved".
    expect(await screen.findByText('120 m3 · Concrete C30 to raft — awaiting approval · source daily log')).toBeTruthy()
    expect(screen.queryByText('Approved')).toBeNull()
    expect(screen.getByTestId('site-status-quantities')).toBeTruthy()
  })

  it('refuses a negative quantity: a correction is a rejection and a new line, never a minus', async () => {
    serve()
    await renderScreen(<DailyLogScreen />)
    await fireEvent.press(await screen.findByTestId('daily-log-add-quantities'))
    await fireEvent.press(screen.getByTestId('entry-activity'))
    await fireEvent.press(await screen.findByTestId('entry-activity-option-a1'))
    await fireEvent.press(screen.getByTestId('entry-item'))
    await fireEvent.press(await screen.findByTestId('entry-item-option-b1'))
    await fireEvent.changeText(screen.getByTestId('entry-quantity'), '-5')
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).toBe(true)
    expect(screen.getByText(/a quantity of 0 or more/)).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('entry-quantity'), '0')
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).toBe(false)
  })

  it('shows a dash and the server’s reason, and no item to choose, when the bill is withheld from this member', async () => {
    serve(siteEngineerSite, dayWithQuantities(), () => failure(403, 'FORBIDDEN', 'You do not have permission to read this section'))
    await renderScreen(<DailyLogScreen />)
    await fireEvent.press(await screen.findByTestId('daily-log-add-quantities'))
    await fireEvent.press(screen.getByTestId('entry-activity'))
    await fireEvent.press(await screen.findByTestId('entry-activity-option-a1'))
    const sheet = within(screen.getByTestId('entry-sheet-quantities'))
    const withheld = within(await sheet.findByTestId('entry-item-withheld'))
    expect(withheld.getByText('—')).toBeTruthy()
    expect(withheld.getByText(/do not have permission/)).toBeTruthy()
    expect(screen.queryByTestId('entry-item')).toBeNull()
    await fireEvent.changeText(screen.getByTestId('entry-quantity'), '120')
    // Nothing can be recorded against an item the server withheld; no zero is invented in its place.
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).toBe(true)
    expect(sheet.queryByText('0')).toBeNull()
  })

  it('offers no quantities form to a member who may read progress but not submit it', async () => {
    serve(financeSite, dayWithQuantities([quantityEntry()]))
    await renderScreen(<DailyLogScreen />)
    expect(await screen.findByText('120 m3 · Concrete C30 to raft — awaiting approval · source daily log')).toBeTruthy()
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('daily-log-add-quantities')).toBeNull()
    expect(screen.queryByTestId('daily-log-add-manpower')).toBeNull()
  })

  it('shows no quantities card on a server whose day does not carry the section', async () => {
    serve(pmSite, emptyLog())
    await renderScreen(<DailyLogScreen />)
    expect(await screen.findByTestId('daily-log-section-notes')).toBeTruthy()
    expect(screen.queryByTestId('daily-log-section-quantities')).toBeNull()
    expect(screen.queryByTestId('site-status-quantities')).toBeNull()
  })
})
