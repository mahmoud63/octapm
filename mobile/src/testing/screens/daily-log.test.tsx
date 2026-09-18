import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import DailyLogScreen, { describeEntry } from '../../../app/(app)/site/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { DailyLog, DailyLogEntry } from '@/api/site-types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { emptyLog, logWithEntries, manpowerEntry, pmSite, siteEngineerSite, today } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: DailyLog

const serve = (permissions = pmSite, log = logWithEntries()) => {
  current = log
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/daily-logs/settings': () => ({ status: 200, body: envelope({ weatherFeedEnabled: true, weatherFeedAvailable: true, hasCoordinates: true, copySections: ['manpower', 'equipment'] }) }),
    [`GET /projects/p1/daily-logs/${today}`]: () => ({ status: 200, body: envelope(current) }),
    [`POST /projects/p1/daily-logs/${today}/entries/manpower`]: (call) => {
      const body = call.body as Record<string, unknown>
      const entry: DailyLogEntry = manpowerEntry({ id: 'e9', clientRequestId: String(body.clientRequestId), companyName: String(body.companyName), trade: body.trade ? String(body.trade) : null, workers: Number(body.workers), hours: Number(body.hours), manHours: Number(body.workers) * Number(body.hours), activity: null, activityId: null })
      current = { ...current, id: current.id ?? 'log1', exists: true, sections: { ...current.sections, manpower: [...current.sections.manpower, entry] }, totals: { ...current.totals, workers: current.totals.workers + entry.workers!, manHours: current.totals.manHours + entry.manHours!, entries: current.totals.entries + 1 } }
      return { status: 201, body: envelope(current) }
    },
    [`POST /projects/p1/daily-logs/${today}/submit`]: () => {
      current = { ...current, status: 'submitted', submittedAt: `${today}T16:00:00.000Z` }
      return { status: 200, body: envelope(current) }
    },
    [`POST /projects/p1/daily-logs/${today}/copy-previous`]: () => ({ status: 200, body: envelope(current) }),
    [`DELETE /projects/p1/daily-logs/${today}/entries/delays/e3`]: () => {
      current = { ...current, sections: { ...current.sections, delays: [] }, totals: { ...current.totals, hoursLost: 0, entries: current.totals.entries - 1 } }
      return { status: 200, body: envelope(current) }
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

describe('the daily log', () => {
  it('describes each kind of entry in one line', () => {
    expect(describeEntry('manpower', manpowerEntry())).toBe('Delta Steelfixing · Steelfixers · 6 workers · 9 h each')
    expect(describeEntry('delays', logWithEntries().sections.delays[0]!)).toBe('Weather · 2 h lost · Sandstorm 11:00–13:00')
    expect(describeEntry('equipment', logWithEntries().sections.equipment[0]!)).toBe('50 t crawler crane · × 1 · 8 h operated · 1 h idle')
  })

  it("shows today's totals, weather, summary and entries", async () => {
    serve()
    await renderScreen(<DailyLogScreen />)
    expect(await screen.findByText('Delta Steelfixing · Steelfixers · 6 workers · 9 h each')).toBeTruthy()
    expect(screen.getByText('Sunny · 24–38 °C · 0 mm rain · 12 km/h wind')).toBeTruthy()
    expect(screen.getByTestId('daily-log-summary').props.children).toBe('Raft pour at grid A-D completed by 15:00.')
    expect(screen.getByText('54')).toBeTruthy()
  })

  it('adds a manpower entry with a replay key, and the totals follow', async () => {
    serve(siteEngineerSite, emptyLog())
    await renderScreen(<DailyLogScreen />)
    await fireEvent.press(await screen.findByTestId('daily-log-add-manpower'))
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('entry-companyName'), 'Delta Steelfixing')
    await fireEvent.changeText(screen.getByTestId('entry-workers'), '6')
    await fireEvent.changeText(screen.getByTestId('entry-hours'), '9')
    await fireEvent.press(screen.getByTestId('entry-save'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/entries/manpower'))).toBe(true))
    const sent = calls.find((c) => c.path.endsWith('/entries/manpower'))!.body as Record<string, unknown>
    expect(sent).toMatchObject({ companyName: 'Delta Steelfixing', workers: 6, hours: 9 })
    expect(String(sent.clientRequestId)).toMatch(/[0-9a-f-]{20,}/)
    expect(await screen.findByText('Delta Steelfixing · 6 workers · 9 h each')).toBeTruthy()
    expect(screen.getByText('54')).toBeTruthy()
  })

  it('submits the day through the submit route and then stops offering edits', async () => {
    serve()
    await renderScreen(<DailyLogScreen />)
    await fireEvent.press(await screen.findByTestId('daily-log-submit'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/submit'))).toBe(true))
    // The status badge and the closing sentence both say submitted.
    expect((await screen.findAllByText(/Submitted/)).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('daily-log-add-manpower')).toBeNull()
    expect(screen.queryByTestId('daily-log-submit')).toBeNull()
  })

  it('removes an entry through its own route', async () => {
    serve()
    await renderScreen(<DailyLogScreen />)
    await fireEvent.press(await screen.findByTestId('daily-log-remove-e3'))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/entries/delays/e3'))).toBe(true))
    await waitFor(() => expect(screen.queryByText(/Sandstorm/)).toBeNull())
  })

  it('a site engineer may add and submit but not fetch weather or write the summary', async () => {
    serve(siteEngineerSite)
    await renderScreen(<DailyLogScreen />)
    await screen.findByTestId('daily-log-add-manpower')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('daily-log-weather')).toBeNull()
    expect(screen.queryByTestId('daily-log-summary-edit')).toBeNull()
    expect(screen.getByTestId('daily-log-submit')).toBeTruthy()
  })
})
