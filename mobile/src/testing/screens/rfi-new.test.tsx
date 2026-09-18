import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router, useLocalSearchParams } from 'expo-router'
import NewRfiScreen from '../../../app/(app)/rfi/new'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { rfiDetail } from '@/testing/fixtures-records'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(router.replace as jest.Mock).mockClear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  calls = fakeServer({
    'GET /projects/p1/team': () => ({ status: 200, body: envelope({ items: [{ userId: 'u1', name: 'Dana Okafor', email: 'pm@octapm.demo', orgRole: 'pm', assignmentRole: 'pm', status: 'active', party: null }, { userId: 'u3', name: 'Ravi Menon', email: 'planner@octapm.demo', orgRole: 'planning_eng', assignmentRole: 'planning_eng', status: 'active', party: null }] }) }),
    'GET /projects/p1/locations': () => ({ status: 200, body: envelope({ items: [{ id: 'l1', parentId: null, name: 'Foundation zone', code: 'GRID-AD', kind: 'zone', fullName: 'Foundation zone, grid A-D', depth: 0, status: 'active', childCount: 0 }] }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope([{ id: 'a1', name: 'Foundation concrete', activityCode: 'A130', wbsCode: '1 Substructure', status: 'in_progress', startDate: null, endDate: null, pctComplete: 40, isCritical: true, isMilestone: false }]) }),
    'POST /projects/p1/rfi': (call) => ({ status: 201, body: envelope(rfiDetail({ id: 'r9', ref: 'RFI-009', ...(call.body as object) })) }),
  })
})

describe('raising an RFI', () => {
  it('refuses to send without a subject', async () => {
    await renderScreen(<NewRfiScreen />)
    await fireEvent.press(screen.getByTestId('rfi-raise'))
    expect(await screen.findByText('Give the RFI a subject')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('sends the subject, question, priority, people and place, with the manager defaulting to me, and opens the new record', async () => {
    await renderScreen(<NewRfiScreen />)
    await fireEvent.changeText(screen.getByTestId('rfi-subject'), 'Rebar cover at the lift pit')
    await fireEvent.changeText(screen.getByTestId('rfi-question'), 'Drawing S-102 shows 40mm; spec says 50mm. Which governs?')
    await fireEvent.press(screen.getByTestId('rfi-priority-urgent'))
    await fireEvent.press(screen.getByTestId('rfi-discipline-structural'))
    await fireEvent.press(screen.getByTestId('rfi-assignees'))
    await fireEvent.press(await screen.findByTestId('rfi-assignees-option-u3'))
    await fireEvent.press(screen.getByTestId('rfi-assignees-done'))
    await fireEvent.press(screen.getByTestId('rfi-location'))
    await fireEvent.press(await screen.findByTestId('rfi-location-option-l1'))
    await fireEvent.press(screen.getByTestId('rfi-schedule-impact'))
    await fireEvent.changeText(await screen.findByTestId('rfi-schedule-days'), '2')
    await fireEvent.press(screen.getByTestId('rfi-raise'))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/rfi')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      subject: 'Rebar cover at the lift pit',
      question: 'Drawing S-102 shows 40mm; spec says 50mm. Which governs?',
      priority: 'urgent',
      status: 'open',
      discipline: 'structural',
      managerUserId: 'u1',
      assigneeUserIds: ['u3'],
      locationId: 'l1',
      scheduleImpactFlag: true,
      scheduleImpact: 2,
    })
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/rfi/r9'))
  })

  it('saves a draft with status draft', async () => {
    await renderScreen(<NewRfiScreen />)
    await fireEvent.changeText(screen.getByTestId('rfi-subject'), 'Draft question')
    await fireEvent.press(screen.getByTestId('rfi-draft'))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ subject: 'Draft question', status: 'draft' }))
  })
})
