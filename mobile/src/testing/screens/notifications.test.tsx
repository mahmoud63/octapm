import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as WebBrowser from 'expo-web-browser'
import NotificationsScreen from '../../../app/(app)/notifications'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { notification, preferences, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

// The second one carries a reminder entity with no screen of its own, so it opens on the web at the repaired task link.
const rows = [notification(), notification({ id: 'n2', title: 'Task: close out punch list level 3', category: 'assignment', priority: 'normal', entityType: 'task_reminder', entityId: 't7', actionUrl: '/projects/p1?module=tasks&taskId=t7' })]
let calls: Call[]
const archived = new Set<string>()

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(WebBrowser.openBrowserAsync as jest.Mock).mockClear()
  archived.clear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  calls = fakeServer({
    'GET /notifications': (call) => ({ status: 200, body: envelope({ rows: (call.query.status === 'unread' ? rows : [...rows, notification({ id: 'n3', title: 'Submittal SUB-004 approved', status: 'read' })]).filter((row) => !archived.has(row.id)), pagination: { limit: 50, nextCursor: null } }) }),
    'GET /notifications/summary': () => ({ status: 200, body: envelope({ unread: 2, read: 1, archived: 0, recent: rows }) }),
    'PATCH /notifications/n1/read': () => ({ status: 200, body: envelope({ ...rows[0], status: 'read' }) }),
    'PATCH /notifications/n2/read': () => ({ status: 200, body: envelope({ ...rows[1], status: 'read' }) }),
    'PATCH /notifications/n1/archive': () => {
      archived.add('n1')
      return { status: 200, body: envelope({ ...rows[0], status: 'archived' }) }
    },
    'POST /notifications/mark-read': () => ({ status: 200, body: envelope({ updated: 2 }) }),
    'GET /notifications/preferences': () => ({ status: 200, body: envelope({ preferences }) }),
    'PUT /notifications/preferences': (call) => ({ status: 200, body: envelope({ preferences: preferences.map((p) => ({ ...p, ...((call.body as { preferences: { category: string }[] }).preferences.find((x) => x.category === p.category) ?? {}) })) }) }),
  })
})

describe('Notifications', () => {
  it('shows unread first, with the count, the priority and the category', async () => {
    await renderScreen(<NotificationsScreen />)
    expect(await screen.findByText('Change order VO-01 needs approval')).toBeTruthy()
    expect(screen.getByText('2 unread')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText(/Approval/)).toBeTruthy()
    expect(screen.queryByText('Submittal SUB-004 approved')).toBeNull()

    await fireEvent.press(screen.getByTestId('chip-all'))
    expect(await screen.findByText('Submittal SUB-004 approved')).toBeTruthy()
  })

  it('opening one marks it read and goes to the record, repairing the task link on the way', async () => {
    await renderScreen(<NotificationsScreen />)
    await fireEvent.press(await screen.findByText('Task: close out punch list level 3'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path === '/notifications/n2/read')).toBe(true))
    expect(calls.find((c) => c.path === '/notifications/n2/read')!.body).toEqual({ read: true })
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1))
    expect((WebBrowser.openBrowserAsync as jest.Mock).mock.calls[0]![0]).toMatch(/\/tasks\?recordId=t7$/)
  })

  it('marks everything read in one tap', async () => {
    await renderScreen(<NotificationsScreen />)
    await screen.findByText('Change order VO-01 needs approval')
    await fireEvent.press(screen.getByTestId('mark-all-read'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/notifications/mark-read')).toBe(true))
  })

  it('archives on a long press and removes the row at once', async () => {
    await renderScreen(<NotificationsScreen />)
    const row = await screen.findByTestId('notification-n1')
    await fireEvent(row, 'longPress')
    await waitFor(() => expect(screen.queryByText('Change order VO-01 needs approval')).toBeNull())
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path === '/notifications/n1/archive')).toBe(true))
  })

  it('saves a preference change for the one category that changed', async () => {
    await renderScreen(<NotificationsScreen />)
    await screen.findByText('Change order VO-01 needs approval')
    await fireEvent.press(screen.getByTestId('toggle-preferences'))
    const push = await screen.findByTestId('pref-approval-push')
    await fireEvent(push, 'valueChange', false)
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/notifications/preferences')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ preferences: [{ category: 'approval', pushEnabled: false }] })
  })
})
