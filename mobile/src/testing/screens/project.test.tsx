import { screen, waitFor } from '@testing-library/react-native'
import ProjectScreen from '../../../app/(app)/project'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { health, page, pmMatrix, projects, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// The forecast as the server sends it: 61 days of projected slip, driven by
// one activity, against a planned finish.
const forecast = (schedule: Record<string, unknown> = {}) => ({
  available: true,
  asOf: '2026-09-19',
  schedule: { plannedFinish: '2026-12-31', projectedFinish: '2027-03-02', slipDays: 61, basis: 'activities', spi: null, cpi: 0.74, criticalDriver: { id: 'a9', name: 'Unitised facade installation', slipDays: 61 }, counts: { activities: 70, open: 69, complete: 1, critical: 3, atRisk: { high: 2, medium: 13, low: 0 } }, ...schedule },
  cost: { budget: 8033600, eac: 10822945.99, projected: 10822945.99, overrun: 2789345.99, overrunPct: 34.7, actual: 4165196, counts: { atRisk: { high: 3, medium: 0, low: 0 }, lines: 5 } },
  summary: { scheduleLevel: 'high', costLevel: 'high' },
})

const routes = (schedule: Record<string, unknown> = {}) => ({
  'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
  'GET /projects/p1/health': () => ({ status: 200, body: envelope(health) }),
  'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmMatrix) }),
  'GET /projects/p1/forecast': () => ({ status: 200, body: envelope(forecast(schedule)) }),
  [`GET /projects/p1/daily-logs/${localDay()}`]: () => ({ status: 200, body: envelope({ exists: false, status: null, weather: null, sections: {}, totals: null }) }),
  'GET /projects/p1/photos': () => ({ status: 200, body: envelope({ items: [], pagination: {}, summary: {} }) }),
})

beforeEach(async () => {
  network.__reset(null)
  await queryClient.cancelQueries()
  queryClient.clear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('Project', () => {
  // Owner decision R5-1: the forecast's slip is a projection, never an
  // approved extension of time, and the screen says so beside the figure.
  it('calls the slip projected: the tile beside its 61 d, the driver line and the finish (R5-1)', async () => {
    fakeServer(routes())
    await renderScreen(<ProjectScreen />)

    const card = await screen.findByTestId('project-forecast')
    // The tile: the label, then the server's 61 days.
    await waitFor(() => expect(card).toHaveTextContent(/Projected slip61 d/))
    expect(screen.getByTestId('project-critical-driver')).toHaveTextContent(/^Longest projected slip: Unitised facade installation · 61 days$/)
    expect(screen.getByText(/^Projected finish .+ against a planned .+$/)).toBeTruthy()
    // Never a bare "Slip", which reads as a fact, and never an extension of time.
    expect(screen.queryByText('Slip')).toBeNull()
    expect(screen.queryByText(/extension of time|\bEOT\b|approved delay|granted/i)).toBeNull()
  })

  it('a slip the server did not send is a dash under the same label, never a zero', async () => {
    fakeServer(routes({ slipDays: null, criticalDriver: null }))
    await renderScreen(<ProjectScreen />)

    const card = await screen.findByTestId('project-forecast')
    await waitFor(() => expect(card).toHaveTextContent(/Projected slip—/))
    expect(card).not.toHaveTextContent(/Projected slip0/)
    expect(screen.queryByTestId('project-critical-driver')).toBeNull()
  })
})
