import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router, useLocalSearchParams } from 'expo-router'
import ActivityScreen from '../../../app/(app)/activities/[id]'
import ActivitiesScreen, { filterActivities } from '../../../app/(app)/activities/index'
import LookaheadScreen from '../../../app/(app)/activities/lookahead'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { health, page, projects, user } from '@/testing/fixtures'
import { activities, activity, lookahead, percentMethod, pmSite, quantityMethod, siteEngineerSite } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]

const serve = (permissions = pmSite) =>
  (calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/health': () => ({ status: 200, body: envelope(health) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'GET /projects/p1/activities/a1': () => ({ status: 200, body: envelope(activity()) }),
    'GET /projects/p1/activities/a2': () => ({ status: 200, body: envelope(activities[1]!) }),
    'GET /projects/p1/activities/a1/progress-method': () => ({ status: 200, body: envelope(percentMethod) }),
    'GET /projects/p1/activities/a2/progress-method': () => ({ status: 200, body: envelope(quantityMethod) }),
    'GET /projects/p1/activities/a1/progress-submissions': () => ({ status: 200, body: envelope([]) }),
    'GET /projects/p1/activities/a2/progress-submissions': () => ({ status: 200, body: envelope([]) }),
    'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }),
    'POST /projects/p1/activities/a1/progress': (call) => ({ status: 201, body: envelope({ id: 'ps1', activityId: 'a1', status: (call.body as { status: string }).status, pctComplete: (call.body as { pctComplete: number }).pctComplete, quantityComplete: null, quantityPlanned: null, quantityUnit: null, progressMethod: 'percent', source: 'mobile', notes: null, createdAt: '2026-09-18T00:00:00.000Z' }) }),
    'POST /projects/p1/activities/a2/progress': (call) => ({ status: 201, body: envelope({ id: 'ps2', activityId: 'a2', status: 'submitted', pctComplete: null, quantityComplete: (call.body as { quantityComplete: number }).quantityComplete, quantityPlanned: 4200, quantityUnit: 'm3', progressMethod: 'quantity', source: 'mobile', notes: null, createdAt: '2026-09-18T00:00:00.000Z' }) }),
    'GET /projects/p1/lookaheads': () => ({ status: 200, body: envelope({ items: [lookahead()], summary: { count: 1, currentId: 'la1', openConstraints: 1 } }) }),
    'GET /projects/p1/lookaheads/la1': () => ({ status: 200, body: envelope(lookahead()) }),
    'POST /projects/p1/lookaheads/la1/items/li2/status': (call) => ({ status: 200, body: envelope({ ...lookahead().items[1]!, ...(call.body as object) }) }),
  }))

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(router.push as jest.Mock).mockClear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('activities in the field', () => {
  it("filters today's work, mine, critical, milestones and delayed on the device", () => {
    expect(filterActivities(activities, 'today', '', 'u1').map((a) => a.id)).toEqual(['a1'])
    expect(filterActivities(activities, 'mine', '', 'u1').map((a) => a.id)).toEqual(['a1'])
    expect(filterActivities(activities, 'critical', '', null).map((a) => a.id)).toEqual(['a1', 'a3'])
    expect(filterActivities(activities, 'milestones', '', null).map((a) => a.id)).toEqual(['a3'])
    expect(filterActivities(activities, 'delayed', '', null).map((a) => a.id)).toEqual(['a4'])
    expect(filterActivities(activities, 'all', 'super', null).map((a) => a.id)).toEqual(['a2'])
  })

  it('lists activities with the approved progress and opens one', async () => {
    serve()
    await renderScreen(<ActivitiesScreen />)
    expect(await screen.findByText('Foundation concrete')).toBeTruthy()
    expect(screen.getByText('40%')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('activities-chip-all'))
    expect(await screen.findByText('Site clearance')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('activity-row-a1'))
    expect(router.push).toHaveBeenCalledWith('/activities/a1')
  })

  it('submits a percent update for approval with source mobile, never touching the approved figure', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'a1' })
    await renderScreen(<ActivityScreen />)
    await fireEvent.press(await screen.findByTestId('action-progress'))
    await fireEvent.press(await screen.findByTestId('progress-quick-75'))
    await fireEvent.changeText(screen.getByTestId('progress-notes'), 'East half poured')
    await fireEvent.press(screen.getByTestId('progress-submit'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/activities/a1/progress')).toBe(true))
    expect(calls.find((c) => c.path === '/projects/p1/activities/a1/progress')!.body).toEqual({ status: 'submitted', source: 'mobile', progressMethod: 'percent', notes: 'East half poured', pctComplete: 75 })
    expect(calls.every((c) => c.method !== 'PATCH')).toBe(true)
  })

  it('asks for a quantity when the activity is measured by quantity, and warns that evidence is required', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'a2' })
    await renderScreen(<ActivityScreen />)
    await fireEvent.press(await screen.findByTestId('action-progress'))
    await fireEvent.changeText(await screen.findByTestId('progress-quantity'), '2100')
    expect(screen.getByText('That is 50% of the plan.')).toBeTruthy()
    expect(screen.getByText(/needs evidence/)).toBeTruthy()
    await fireEvent.press(screen.getByTestId('progress-submit'))
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/activities/a2/progress')?.body).toMatchObject({ quantityComplete: 2100, quantityPlanned: 4200, quantityUnit: 'm3', status: 'submitted', source: 'mobile' }))
  })

  it('does not offer a progress update to a site engineer who is not assigned to the activity', async () => {
    serve(siteEngineerSite)
    useAuthStore.setState({ user: { ...user, id: 'u2', role: 'site_engineer' } })
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'a2' })
    await renderScreen(<ActivityScreen />)
    await screen.findByText('Superstructure level 1')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-progress')).toBeNull()
    expect(screen.getByText(/Only the engineers assigned/)).toBeTruthy()
  })

  it('records a lookahead item as not done with the reason the planner needs', async () => {
    serve(siteEngineerSite)
    await renderScreen(<LookaheadScreen />)
    expect(await screen.findByText('Backfill east side')).toBeTruthy()
    expect(screen.getByText(/Constraint \(open\)/)).toBeTruthy()
    await fireEvent.press(screen.getByTestId('lookahead-li2-not_done'))
    expect(screen.getByTestId('lookahead-li2-confirm').props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(screen.getByTestId('lookahead-li2-reason-permit'))
    await fireEvent.press(screen.getByTestId('lookahead-li2-confirm'))
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/lookaheads/la1/items/li2/status')?.body).toEqual({ status: 'not_done', varianceReason: 'permit' }))
  })
})
