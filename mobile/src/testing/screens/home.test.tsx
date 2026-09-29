import { screen, waitFor } from '@testing-library/react-native'
import HomeScreen from '../../../app/(app)/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { assignments, health, notification, page, pmMatrix, projects, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const routes = {
  'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
  'GET /projects/p1/assignments/mine': () => ({ status: 200, body: envelope(assignments) }),
  'GET /projects/p1/health': () => ({ status: 200, body: envelope(health) }),
  'GET /notifications/summary': () => ({ status: 200, body: envelope({ unread: 4, read: 2, archived: 0, recent: [notification(), notification({ id: 'n2', title: 'RFI-001 was answered', status: 'read' })] }) }),
  'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmMatrix) }),
  'GET /projects/p1/forecast': () => ({
    status: 200,
    body: envelope({
      available: true,
      asOf: '2026-09-19',
      schedule: { plannedFinish: '2026-12-31', projectedFinish: '2027-03-02', slipDays: 61, basis: 'activities', spi: null, cpi: 0.74, criticalDriver: { id: 'a9', name: 'Unitised facade installation', slipDays: 61 }, counts: { activities: 70, open: 69, complete: 1, critical: 3, atRisk: { high: 2, medium: 13, low: 0 } } },
      cost: { budget: 8033600, eac: 10822945.99, projected: 10822945.99, overrun: 2789345.99, overrunPct: 34.7, actual: 4165196, counts: { atRisk: { high: 3, medium: 0, low: 0 }, lines: 5 } },
      summary: { scheduleLevel: 'high', costLevel: 'high' },
    }),
  }),
  [`GET /projects/p1/daily-logs/${localDay()}`]: () => ({ status: 200, body: envelope({ exists: true, status: 'open', weather: null, sections: {}, totals: { workers: 142, manHours: 1136, companies: 9, equipmentCount: 11, equipmentHours: 78, idleHours: 6, deliveries: 6, visitors: 4, hoursLost: 3.5, notes: 0, entries: 12, awaitingReview: 0, suggestedDelays: 2 } }) }),
  'GET /projects/p1/photos': () => ({ status: 200, body: envelope({ items: [], pagination: {}, summary: {} }) }),
}

beforeEach(async () => {
  network.__reset(null)
  // A fetch still in flight from the previous test would land in the shared cache after the clear: cancel it first.
  await queryClient.cancelQueries()
  queryClient.clear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('Home', () => {
  it('leads a project manager with the project, not with a module directory', async () => {
    fakeServer(routes)
    await renderScreen(<HomeScreen />)

    expect(screen.getByText(/Good (morning|afternoon|evening), Dana/)).toBeTruthy()
    expect(await screen.findByText('Riverside Tower')).toBeTruthy()

    // The order the brief asks for: status, then what needs deciding, then the
    // risks, then the site, then the numbers — and only then actions.
    expect(await screen.findByTestId('pm-status')).toBeTruthy()
    expect(screen.getByTestId('pm-needs-you')).toBeTruthy()
    expect(await screen.findByTestId('pm-risks')).toBeTruthy()
    expect(screen.getByTestId('pm-today-on-site')).toBeTruthy()
    expect(screen.getByTestId('pm-pulse')).toBeTruthy()
    expect(screen.getByTestId('pm-quick-actions')).toBeTruthy()

    // The wall of thirteen identical module buttons is gone from Home.
    expect(screen.queryByTestId('records-rfi')).toBeNull()
    expect(screen.queryByTestId('records-documents')).toBeNull()
  })

  it('shows the money and the programme the server computed, and nothing it did not', async () => {
    fakeServer(routes)
    await renderScreen(<HomeScreen />)

    // SPI is genuinely null on this forecast: an em-dash, never a made-up 1.00.
    const pulse = await screen.findByTestId('pm-pulse')
    expect(pulse).toBeTruthy()
    expect(await screen.findByText('0.74')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByTestId('pm-critical-driver')).toBeTruthy()
    expect(screen.getByText(/Unitised facade installation/)).toBeTruthy()
    // Each count under its own accurate label (F3): the activities at high
    // cost risk (atRisk.high, 3) and the budget lines projected over (5).
    expect(screen.getByTestId('count-cost-risk')).toHaveTextContent(/^3Activities at high cost risk$/)
    expect(screen.getByTestId('count-budget-lines')).toHaveTextContent(/^5Budget lines over budget$/)
    // A reader who receives the money is told no reason for a withholding.
    expect(screen.queryByTestId('pm-status-cost-withheld')).toBeNull()
    expect(screen.queryByTestId('pm-pulse-cost-withheld')).toBeNull()
    expect(screen.queryByTestId('pm-cost-risk-withheld')).toBeNull()
  })

  // Marina Bay's forecast as the server sends it (owner F3, 2026-09-28): one
  // activity at high cost risk, ten budget lines projected over.
  const marinaBay = (cost: Record<string, unknown>) => ({
    ...routes,
    'GET /projects/p1/forecast': () => ({
      status: 200,
      body: envelope({
        available: true,
        asOf: '2026-09-28',
        schedule: { plannedFinish: '2027-06-30', projectedFinish: '2027-07-21', slipDays: 21, basis: 'activities', spi: 0.93, cpi: 0.88, criticalDriver: null, counts: { activities: 64, open: 50, complete: 14, critical: 9, atRisk: { high: 4, medium: 6, low: 2 } } },
        cost,
        summary: { scheduleLevel: 'high', costLevel: 'high' },
      }),
    }),
  })

  it('a BOQ reader on Marina Bay sees 1 activity at high cost risk and 10 budget lines over budget, each under its own label (F3)', async () => {
    fakeServer(marinaBay({ budget: 41200000, eac: 44900000, projected: 44900000, overrun: 3700000, overrunPct: 9, actual: 12800000, counts: { atRisk: { high: 1, medium: 2, low: 0 }, lines: 10 } }))
    await renderScreen(<HomeScreen />)
    expect(await screen.findByTestId('count-cost-risk')).toHaveTextContent(/^1Activities at high cost risk$/)
    expect(screen.getByTestId('count-budget-lines')).toHaveTextContent(/^10Budget lines over budget$/)
    expect(screen.getByTestId('count-at-risk')).toHaveTextContent(/^4Activities at high risk$/)
    expect(screen.queryByTestId('pm-cost-risk-withheld')).toBeNull()
  })

  it("a cost reader without BOQ read on Marina Bay: the activity tile is a dash with the server's reason; the budget lines and the money stay (F3, E1)", async () => {
    // What the server sends a cost reader who may not read the BOQ: no
    // atRisk tally, activityCostWithheld and its sentence.
    fakeServer(marinaBay({ budget: 41200000, eac: 44900000, projected: 44900000, overrun: 3700000, overrunPct: 9, actual: 12800000, counts: { lines: 10 }, activityCostWithheld: true, activityCostReason: 'Mapping details unavailable to you' }))
    await renderScreen(<HomeScreen />)
    expect(await screen.findByTestId('count-cost-risk')).toHaveTextContent(/^—Activities at high cost risk$/)
    expect(screen.getByTestId('pm-cost-risk-withheld')).toHaveTextContent('— Mapping details unavailable to you')
    expect(screen.getByTestId('count-budget-lines')).toHaveTextContent(/^10Budget lines over budget$/)
    // The project's money is theirs: no reason is given for it.
    expect(screen.queryByTestId('pm-status-cost-withheld')).toBeNull()
    expect(screen.queryByTestId('pm-pulse-cost-withheld')).toBeNull()
  })

  it("a forecast whose cost is withheld (§12) reads a dash and the server's reason for the money — never an unexplained blank", async () => {
    fakeServer({
      ...routes,
      'GET /projects/p1/forecast': () => ({
        status: 200,
        body: envelope({
          available: true,
          asOf: '2026-09-19',
          schedule: { plannedFinish: '2026-12-31', projectedFinish: '2027-03-02', slipDays: 61, basis: 'activities', spi: null, cpi: 0.74, criticalDriver: null, counts: { activities: 70, open: 69, complete: 1, critical: 3, atRisk: { high: 2, medium: 13, low: 0 } } },
          // What the server sends a member who reads neither the BOQ nor the cost module.
          cost: { counts: { lines: 5 }, budgetLines: [], withheld: true, reason: 'Cost figures are not available to you' },
          summary: { scheduleLevel: 'high', costLevel: 'high' },
        }),
      }),
    })
    await renderScreen(<HomeScreen />)
    // The budget lines over are the cost module's own and still sent…
    expect(await screen.findByTestId('count-budget-lines')).toHaveTextContent(/^5Budget lines over budget$/)
    // …the activities at high cost risk are not: a dash, and the reason.
    expect(screen.getByTestId('count-cost-risk')).toHaveTextContent(/^—Activities at high cost risk$/)
    expect(screen.getByTestId('pm-cost-risk-withheld')).toHaveTextContent('— Cost figures are not available to you')
    expect(screen.getByTestId('count-critical')).toHaveTextContent(/3/)
    // The overrun is a dash, with the reason beside it…
    expect(await screen.findByText('Overrun')).toBeTruthy()
    expect(await screen.findByTestId('pm-status-cost-withheld')).toHaveTextContent('— Cost figures are not available to you')
    // …and so are the actual cost and the forecast at completion.
    expect(screen.getByTestId('pm-pulse-cost-withheld')).toHaveTextContent('— Cost figures are not available to you')
  })

  it("reports the site's own totals, which the app never recomputes", async () => {
    fakeServer(routes)
    await renderScreen(<HomeScreen />)
    expect(await screen.findByTestId('count-workers')).toBeTruthy()
    expect(screen.getByText('142')).toBeTruthy()
    expect(screen.getByText('1136')).toBeTruthy()
    expect(screen.getByText('3.5')).toBeTruthy()
  })

  it('still surfaces what needs the person, first', async () => {
    fakeServer(routes)
    await renderScreen(<HomeScreen />)
    expect(await screen.findByText('Honeycombing in column C4')).toBeTruthy()
    expect(screen.getAllByText(/Ball in court/).length).toBeGreaterThan(0)
    expect(await screen.findByTestId('health-supplyChain')).toBeTruthy()
    expect(await screen.findByTestId('quick-rfi')).toBeTruthy()
  })

  it('opens the only project without asking', async () => {
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
    fakeServer({ ...routes, 'GET /projects': () => ({ status: 200, body: envelope(page([projects[0]!])) }) })
    await renderScreen(<HomeScreen />)
    await waitFor(() => expect(useProjectStore.getState().currentProjectId).toBe('p1'))
  })

  it('asks which project when there are several and none is chosen', async () => {
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
    fakeServer(routes)
    await renderScreen(<HomeScreen />)
    // The project strip says "Choose a project" before the list has loaded; the rows are what prove the chooser.
    expect(await screen.findByText('Harbour Bridge')).toBeTruthy()
    expect(screen.getAllByText('Choose a project').length).toBeGreaterThan(0)
    expect(screen.queryByText('Needs You')).toBeNull()
  })

  it('drops a project the person no longer has, and everything cached about it', async () => {
    useProjectStore.setState({ currentProjectId: 'p9', hydrated: true })
    queryClient.setQueryData(['project', 'p9', 'rfis'], [{ id: 'stale' }])
    fakeServer(routes)
    await renderScreen(<HomeScreen />)
    await waitFor(() => expect(useProjectStore.getState().currentProjectId).toBeNull())
    expect(queryClient.getQueryData(['project', 'p9', 'rfis'])).toBeUndefined()
    expect(await screen.findAllByText('Choose a project')).not.toHaveLength(0)
  })

  it('says when the person is on no project at all', async () => {
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
    fakeServer({ ...routes, 'GET /projects': () => ({ status: 200, body: envelope(page([])) }) })
    await renderScreen(<HomeScreen />)
    expect(await screen.findByText('You are not on any project yet')).toBeTruthy()
  })
})
