import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import HomeScreen from '../../../app/(app)/index'
import OutboxScreen from '../../../app/(app)/outbox'
import NewPunchScreen from '../../../app/(app)/quality/punch/new'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { ConnectivityBar } from '@/components/ConnectivityBar'
import { __resetOutboxForTests, drainOutbox, enqueue, hydrateOutbox, registerSender, useOutbox } from '@/offline/outbox'
import { registerSenders } from '@/offline/senders'
import { __useStoreForTests, memoryStore } from '@/offline/storage'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { assignments, health, notification, page, projects, user } from '@/testing/fixtures'
import { pmQuality, punchItem } from '@/testing/fixtures-quality'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]

const serve = () => {
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmQuality) }),
    'GET /projects/p1/assignments/mine': () => ({ status: 200, body: envelope(assignments) }),
    'GET /projects/p1/health': () => ({ status: 200, body: envelope(health) }),
    'GET /notifications/summary': () => ({ status: 200, body: envelope({ unread: 0, read: 0, archived: 0, recent: [notification()] }) }),
    'GET /projects/p1/team': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/locations': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'POST /projects/p1/punch': (call) => ({ status: 201, body: envelope(punchItem({ id: 'pi9', title: String((call.body as { title: string }).title) })) }),
    'POST /projects/p1/attachments': () => ({ status: 201, body: envelope({ items: [] }) }),
  })
}

beforeEach(async () => {
  __useStoreForTests(memoryStore())
  __resetOutboxForTests()
  await hydrateOutbox()
  network.__reset(true)
  await queryClient.cancelQueries()
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

afterAll(() => __useStoreForTests(null))

describe('capturing without a signal', () => {
  it('keeps a punch item and its photos in the outbox, the photos behind the item, and goes to the outbox', async () => {
    serve()
    network.__reset(false)
    ;(ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/tile.jpg', fileName: 'tile.jpg', mimeType: 'image/jpeg' }] })
    const router = useRouter() as unknown as { replace: jest.Mock }
    await renderScreen(<NewPunchScreen />)
    await fireEvent.press(await screen.findByTestId('punch-library'))
    await screen.findByText('1 photo ready')
    await fireEvent.changeText(screen.getByTestId('punch-title'), 'Chipped tile at lobby entrance')
    await fireEvent.press(screen.getByTestId('punch-raise'))
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/outbox'))
    const items = useOutbox.getState().items
    expect(items.map((i) => [i.kind, i.status])).toEqual([
      ['punch.create', 'waiting'],
      ['attachment.upload', 'waiting'],
    ])
    expect(items[1]!.dependsOn).toBe(items[0]!.id)
    expect((items[1]!.payload as { files: { uri: string }[] }).files[0]!.uri).toMatch(/outbox\//)
    // Nothing went to the server.
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('sends the queue when the signal returns, the item first and the photos with the id it was given', async () => {
    serve()
    network.__reset(false)
    const parent = await enqueue({ projectId: 'p1', kind: 'punch.create', summary: 'Chipped tile', payload: { body: { title: 'Chipped tile', status: 'open', clientRequestId: 'key-1' } }, clientRequestId: 'key-1' })
    await enqueue({ projectId: 'p1', kind: 'attachment.upload', summary: '1 photo', payload: { recordType: 'punch_item', recordId: null, role: 'photo', files: [{ uri: 'file:///doc/outbox/tile.jpg', name: 'tile.jpg', type: 'image/jpeg' }] }, clientRequestId: 'key-2', dependsOn: parent.id })
    registerSenders()
    network.__reset(true)
    await drainOutbox('test')
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/projects/p1/punch', '/projects/p1/attachments'])
    expect((calls[0]!.body as { clientRequestId: string }).clientRequestId).toBe('key-1')
    expect(String(calls[1]!.body)).toContain('pi9')
    expect(useOutbox.getState().items.every((i) => i.status === 'sent')).toBe(true)
  })
})

describe('what the person sees', () => {
  it('shows the bar offline, and counts what is waiting or needs attention', async () => {
    network.__reset(false)
    await renderScreen(<ConnectivityBar />)
    expect(await screen.findByText('Offline · showing what was saved on this device')).toBeTruthy()
    registerSender('punch.create', async () => {
      throw new Error('never')
    })
    await enqueue({ projectId: 'p1', kind: 'punch.create', summary: 'Chipped tile', payload: {}, clientRequestId: 'k1' })
    expect(await screen.findByText('Offline · 1 item waiting to send')).toBeTruthy()
    useOutbox.setState((s) => ({ items: s.items.map((i) => ({ ...i, status: 'attention', error: { code: 'VALIDATION', message: 'A title is required' } })) }))
    expect(await screen.findByText('1 item needs your attention')).toBeTruthy()
  })

  it('shows the outbox card on Home when something is waiting', async () => {
    serve()
    network.__reset(false)
    await enqueue({ projectId: 'p1', kind: 'daily-log.entry', summary: 'Manpower entry', payload: {}, clientRequestId: 'k1' })
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<HomeScreen />)
    expect(await screen.findByTestId('home-outbox')).toBeTruthy()
    expect(screen.getByText('1 item waiting to send')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('home-outbox-open'))
    expect(router.push).toHaveBeenCalledWith('/outbox')
  })

  it('lists the queue with the server reasons, and retries or discards what needs attention', async () => {
    serve()
    network.__reset(false)
    const a = await enqueue({ projectId: 'p1', kind: 'punch.create', summary: 'Chipped tile', payload: {}, clientRequestId: 'k1' })
    const b = await enqueue({ projectId: 'p1', kind: 'timesheet.create', summary: 'Timesheet for 2026-09-18', payload: {}, clientRequestId: 'k2' })
    useOutbox.setState((s) => ({ items: s.items.map((i) => (i.id === a.id ? { ...i, status: 'attention', error: { code: 'VALIDATION', serverCode: 'PUNCH_TITLE_REQUIRED', message: 'A title is required', requestId: 'req-12345678' } } : i)) }))
    await renderScreen(<OutboxScreen />)
    expect(await screen.findByText('Needs your attention')).toBeTruthy()
    expect(screen.getByText('A title is required (ref req-1234)')).toBeTruthy()
    expect(screen.getByText('Timesheet for 2026-09-18')).toBeTruthy()
    await fireEvent.press(screen.getByTestId(`outbox-retry-${a.id}`))
    await waitFor(() => expect(useOutbox.getState().items.find((i) => i.id === a.id)?.status).toBe('waiting'))
    await fireEvent.press(screen.getByTestId(`outbox-discard-${b.id}`))
    await waitFor(() => expect(useOutbox.getState().items.find((i) => i.id === b.id)).toBeUndefined())
    expect(screen.queryByText('Timesheet for 2026-09-18')).toBeNull()
  })
})
