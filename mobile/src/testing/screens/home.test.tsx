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
  })

  it('a forecast whose cost is withheld (§12) reads a dash for the cost lines at risk — the tally is read off the mapping, so it is not sent', async () => {
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
    const costRisk = await screen.findByTestId('count-cost-risk')
    expect(costRisk).toHaveTextContent(/—/)
    expect(screen.getByTestId('count-critical')).toHaveTextContent(/3/)
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
