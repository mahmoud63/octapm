import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as ImagePicker from 'expo-image-picker'
import { router, useLocalSearchParams } from 'expo-router'
import PhotoScreen from '../../../app/(app)/photos/[id]'
import PhotosScreen from '../../../app/(app)/photos/index'
import TimesheetScreen from '../../../app/(app)/timesheets/[id]'
import NewTimesheetScreen from '../../../app/(app)/timesheets/new'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { Timesheet } from '@/api/site-types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { emptyLog, photo, pmSite, timesheet, today } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let sheet: Timesheet

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(router.replace as jest.Mock).mockClear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  sheet = timesheet()
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmSite) }),
    'GET /projects/p1/photos': () => ({ status: 200, body: envelope({ items: [photo(), photo({ id: 'ph2', caption: 'Rebar cage, lift pit', tags: ['rebar'] })], pagination: { limit: 60, nextCursor: null }, summary: { total: 2, tags: ['concrete', 'grid A-D', 'rebar'] } }) }),
    'PATCH /projects/p1/photos/ph1': (call) => ({ status: 200, body: envelope(photo(call.body as object)) }),
    [`GET /projects/p1/daily-logs/${today}`]: () => ({ status: 200, body: envelope(emptyLog()) }),
    [`POST /projects/p1/daily-logs/${today}/entries/notes`]: () => ({ status: 201, body: envelope(emptyLog(today, { id: 'log1', exists: true })) }),
    'POST /projects/p1/attachments': () => ({ status: 201, body: envelope({ items: [] }) }),
    'GET /projects/p1/timesheets/crews': () => ({ status: 200, body: envelope({ items: [{ id: 'crew1', name: 'Steelfixing crew A', companyId: null, defaultActivityId: 'a1', workerIds: ['w1', 'w2'] }] }) }),
    'GET /projects/p1/timesheets/workers': () => ({ status: 200, body: envelope({ items: [{ id: 'w1', name: 'Ahmed Ali', companyId: null, trade: 'Steelfixer', status: 'active' }, { id: 'w2', name: 'Joseph Okoro', companyId: null, trade: 'Steelfixer', status: 'active' }] }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope([{ id: 'a1', name: 'Foundation concrete', activityCode: 'A130', wbsCode: '1', status: 'in_progress', startDate: null, endDate: null, pctComplete: 40, isCritical: true, isMilestone: false }]) }),
    'POST /projects/p1/timesheets': (call) => ({ status: 201, body: envelope(timesheet({ id: 'ts9', ...(call.body as object) })) }),
    'GET /projects/p1/timesheets/ts1': () => ({ status: 200, body: envelope(sheet) }),
    'POST /projects/p1/timesheets/ts1/submit': () => {
      sheet = { ...sheet, status: 'submitted' }
      return { status: 200, body: envelope(sheet) }
    },
  })
})

describe('photos', () => {
  it('shows the gallery with its tags and opens a photo', async () => {
    await renderScreen(<PhotosScreen />)
    expect(await screen.findByText('Raft pour, grid A-D')).toBeTruthy()
    expect(screen.getByTestId('photos-tag-rebar')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('photo-ph2'))
    expect(router.push).toHaveBeenCalledWith('/photos/ph2')
  })

  it('a chosen photo goes onto today’s daily log with a caption and a replay key, starting the log if needed', async () => {
    ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///tmp/raft.jpg', fileName: 'raft.jpg', mimeType: 'image/jpeg' }] })
    await renderScreen(<PhotosScreen />)
    await fireEvent.press(await screen.findByTestId('photos-library'))
    await fireEvent.changeText(await screen.findByTestId('prompt-caption-input'), 'Raft pour, east half')
    await fireEvent.press(screen.getByTestId('prompt-caption-confirm'))
    await waitFor(() => {
      const failure = screen.queryByTestId('photos-failure')
      expect(failure ? `FAILURE: ${String(failure.props.children)}` : calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /projects/p1/attachments')
    })
    // The log did not exist yet, so a note entry started it before the photo went on.
    const order = calls.map((c) => `${c.method} ${c.path}`)
    expect(order.indexOf(`POST /projects/p1/daily-logs/${today}/entries/notes`)).toBeLessThan(order.indexOf('POST /projects/p1/attachments'))
    expect(calls.find((c) => c.path === '/projects/p1/attachments')!.headers.authorization).toBe('Bearer access-1')
  })

  it('a photo shows its details and its caption can be corrected', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'ph1' })
    await renderScreen(<PhotoScreen />)
    expect(await screen.findByText('Raft pour, grid A-D')).toBeTruthy()
    expect(screen.getByText(/iPhone 15/)).toBeTruthy()
    expect(screen.getByText(/Position recorded by the camera/)).toBeTruthy()
    await fireEvent.press(screen.getByTestId('photo-edit-caption'))
    await fireEvent.changeText(await screen.findByTestId('prompt-photo-caption-input'), 'Raft pour, grid A-D, east half')
    await fireEvent.press(screen.getByTestId('prompt-photo-caption-confirm'))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/projects/p1/photos/ph1')?.body).toEqual({ caption: 'Raft pour, grid A-D, east half' }))
  })
})

describe('timesheets', () => {
  it('a crew brings its workers with default hours; saving sends the entries with a replay key and opens the sheet', async () => {
    await renderScreen(<NewTimesheetScreen />)
    await fireEvent.press(await screen.findByTestId('timesheet-crew'))
    await fireEvent.press(await screen.findByTestId('timesheet-crew-option-crew1'))
    expect(await screen.findByText('Ahmed Ali')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('timesheet-hours-w2'), '10')
    await fireEvent.press(screen.getByTestId('timesheet-save'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/timesheets')).toBe(true))
    const body = calls.find((c) => c.method === 'POST' && c.path === '/projects/p1/timesheets')!.body as { date: string; crewId: string; clientRequestId: string; entries: { workerId: string; hours: number; activityId: string }[] }
    expect(body.date).toBe(today)
    expect(body.crewId).toBe('crew1')
    expect(body.clientRequestId).toMatch(/[0-9a-f-]{20,}/)
    expect(body.entries).toEqual([
      { workerId: 'w1', activityId: 'a1', timeType: 'regular', hours: 8 },
      { workerId: 'w2', activityId: 'a1', timeType: 'regular', hours: 10 },
    ])
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/timesheets/ts9'))
  })

  it('a draft sheet can be submitted for approval, after which the action is gone', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'ts1' })
    await renderScreen(<TimesheetScreen />)
    expect(await screen.findByText('Steelfixing crew A')).toBeTruthy()
    expect(screen.getByText('18')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-submit'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/timesheets/ts1/submit')).toBe(true))
    await waitFor(() => expect(screen.queryByTestId('action-submit')).toBeNull())
    expect(await screen.findByText(/Submitted; approval happens on the web/)).toBeTruthy()
  })
})
