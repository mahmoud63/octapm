import { QueryClient } from '@tanstack/react-query'
import { keys, queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { __realtimeForTests, invalidateForEvent, startRealtime, useRealtimeStore } from './index'

type Handler = (...args: unknown[]) => void

/** The fake socket the mocked socket.io-client hands out. */
interface FakeSocket {
  connected: boolean
  auth: unknown
  handlers: Record<string, Handler[]>
  emitted: { event: string; payload: unknown; ack?: (reply: unknown) => void }[]
  on: (event: string, handler: Handler) => FakeSocket
  emit: (event: string, payload: unknown, ack?: (reply: unknown) => void) => FakeSocket
  connect: () => FakeSocket
  disconnect: () => FakeSocket
  removeAllListeners: () => FakeSocket
  fire: (event: string, ...args: unknown[]) => void
}

const sockets: FakeSocket[] = []
const mockIo = jest.fn((_url: string, opts: { auth: unknown }) => {
  const socket: FakeSocket = {
    connected: false,
    auth: opts.auth,
    handlers: {},
    emitted: [],
    on(event, handler) {
      ;(socket.handlers[event] ??= []).push(handler)
      return socket
    },
    emit(event, payload, ack) {
      socket.emitted.push({ event, payload, ack })
      return socket
    },
    connect() {
      socket.connected = true
      socket.fire('connect')
      return socket
    },
    disconnect() {
      socket.connected = false
      socket.fire('disconnect')
      return socket
    },
    removeAllListeners() {
      socket.handlers = {}
      return socket
    },
    fire(event, ...args) {
      for (const handler of socket.handlers[event] ?? []) handler(...args)
    },
  }
  sockets.push(socket)
  // autoConnect: the real client connects on the next tick; the fake connects at once.
  setTimeout(() => socket.connect(), 0)
  return socket
})
jest.mock('socket.io-client', () => ({ io: (...args: unknown[]) => (mockIo as unknown as (...a: unknown[]) => unknown)(...args) }))

const P = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
const user = { id: 'u1', email: 'pm@octapm-e2e.test', name: 'Dana', role: 'project_manager' as const, orgId: 'org', status: 'active', isCompanyAdmin: false }


describe('realtime', () => {
  let stop: () => void = () => undefined
  beforeEach(() => {
    jest.useFakeTimers()
    sockets.length = 0
    mockIo.mockClear()
    useAuthStore.setState({ status: 'signedOut', accessToken: null, user: null })
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
  })
  afterEach(() => {
    stop()
    __realtimeForTests.reset()
    jest.useRealTimers()
  })

  it('marks the project and the person’s queues stale by event, and ignores job progress', () => {
    const client = new QueryClient()
    const spy = jest.spyOn(client, 'invalidateQueries')
    expect(invalidateForEvent(client, { type: 'record.changed', projectId: P, entityType: 'rfi', entityId: 'r1' })).toEqual([`project:${P}`])
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: keys.projectScoped(P), refetchType: 'active' }))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: keys.needsYou(P) }))
    // A notification is the only announcement an approval makes when it is
    // raised — the bus has approval.decided but nothing for a step appearing —
    // so it has to refresh the approvals inbox too, or a change order submitted
    // for this person waits out the list's half-minute before it shows.
    expect(invalidateForEvent(client, { type: 'notification.created', entityType: 'rfi' })).toEqual(['notifications', 'needs-you', 'my-steps'])
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['workflow', 'my-steps'] }))
    expect(invalidateForEvent(client, { type: 'approval.decided', projectId: P, entityType: 'change_order' })).toEqual([`project:${P}`, 'my-steps'])
    expect(invalidateForEvent(client, { type: 'job.progress', projectId: P, entityType: 'background_job' })).toEqual([])
    expect(invalidateForEvent(client, { type: 'record.changed', projectId: P, entityType: 'task', entityId: 't1' })).toEqual([`project:${P}`, 'tasks'])
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: keys.tasks }))
  })

  it('connects with the session token, joins the current project room and follows a project switch', () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-1', user })
    useProjectStore.setState({ currentProjectId: P })
    stop = startRealtime()
    expect(mockIo).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ auth: { token: 'token-1' }, transports: ['websocket'] }))
    jest.advanceTimersByTime(1)
    const socket = sockets[0]!
    expect(useRealtimeStore.getState().connected).toBe(true)
    const join = socket.emitted.find((e) => e.event === 'project:join')!
    expect(join.payload).toEqual({ projectId: P })
    join.ack?.({ ok: true, projectId: P })
    expect(__realtimeForTests.joined()).toBe(P)
    expect(useRealtimeStore.getState().room).toBe(P)

    // Switching project leaves the old room and joins the new one.
    const other = 'b2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
    useProjectStore.setState({ currentProjectId: other })
    expect(socket.emitted.some((e) => e.event === 'project:leave' && (e.payload as { projectId: string }).projectId === P)).toBe(true)
    const rejoin = socket.emitted.filter((e) => e.event === 'project:join').pop()!
    expect(rejoin.payload).toEqual({ projectId: other })
  })

  it('catches up on what it missed the moment it is in the room', () => {
    // Anything that changed before the room was joined — a first load, or a
    // reconnection after the signal went — arrived nowhere. Without this the
    // screen keeps showing what it had when it lost touch, and nothing tells it.
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-1', user })
    useProjectStore.setState({ currentProjectId: P })
    stop = startRealtime()
    jest.advanceTimersByTime(1)
    const socket = sockets[0]!
    const spy = jest.spyOn(queryClient, 'invalidateQueries')
    socket.emitted.find((e) => e.event === 'project:join')!.ack?.({ ok: true, projectId: P })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: keys.projectScoped(P), refetchType: 'active' }))
    spy.mockRestore()
  })

  it('refreshes within the ceiling however long the burst goes on', () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-1', user })
    useProjectStore.setState({ currentProjectId: P })
    stop = startRealtime()
    jest.advanceTimersByTime(1)
    const socket = sockets[0]!
    socket.emitted.find((e) => e.event === 'project:join')!.ack?.({ ok: true, projectId: P })

    const spy = jest.spyOn(queryClient, 'invalidateQueries')
    // A change every 300 ms for four seconds: each one pushes the 400 ms wait
    // back, so without a ceiling the refresh never happens at all.
    for (let elapsed = 0; elapsed < 4_000; elapsed += 300) {
      socket.fire('domain.event', { type: 'record.changed', projectId: P, entityType: 'rfi', entityId: `r${elapsed}` })
      jest.advanceTimersByTime(300)
    }
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('coalesces a burst of events into one invalidation and carries a refreshed token', () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-1', user })
    useProjectStore.setState({ currentProjectId: P })
    stop = startRealtime()
    jest.advanceTimersByTime(1)
    const socket = sockets[0]!
    const spy = jest.spyOn(queryClient, 'invalidateQueries')
    for (let i = 0; i < 5; i += 1) socket.fire('domain.event', { type: 'record.changed', projectId: P, entityType: 'rfi', entityId: `r${i}` })
    expect(spy).not.toHaveBeenCalled()
    jest.advanceTimersByTime(500)
    expect(spy.mock.calls.filter(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey) === JSON.stringify(keys.projectScoped(P)))).toHaveLength(1)
    expect(useRealtimeStore.getState().lastEventAt).not.toBeNull()

    useAuthStore.setState({ accessToken: 'token-2' })
    expect(socket.auth).toEqual({ token: 'token-2' })
    expect(mockIo).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('disconnects when the session ends and reconnects for the next sign-in', () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-1', user })
    stop = startRealtime()
    jest.advanceTimersByTime(1)
    expect(sockets).toHaveLength(1)
    useAuthStore.setState({ status: 'signedOut', accessToken: null, user: null })
    expect(sockets[0]!.connected).toBe(false)
    expect(useRealtimeStore.getState().connected).toBe(false)
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-3', user })
    jest.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)
    expect(sockets[1]!.auth).toEqual({ token: 'token-3' })
  })

  it('drops the socket and its rooms while a workspace switch runs, and reconnects with the new token in the new workspace', () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-a', user })
    useProjectStore.setState({ currentProjectId: P })
    stop = startRealtime()
    jest.advanceTimersByTime(1)
    const inA = sockets[0]!
    inA.emitted.find((e) => e.event === 'project:join')!.ack?.({ ok: true, projectId: P })
    expect(__realtimeForTests.joined()).toBe(P)

    // 1. freeze: the socket goes, the room is forgotten, nothing is joined under the old token.
    useAuthStore.getState().setSwitching(true)
    expect(inA.connected).toBe(false)
    expect(__realtimeForTests.joined()).toBeNull()
    expect(useRealtimeStore.getState()).toMatchObject({ connected: false, room: null })
    // The new token and workspace arrive while frozen: still no socket.
    useAuthStore.setState({ accessToken: 'token-b' })
    useProjectStore.setState({ currentProjectId: null })
    expect(sockets).toHaveLength(1)
    // 7. unfreeze: a fresh socket with the new token; no project room is joined until the new workspace's project is chosen.
    useAuthStore.getState().setSwitching(false)
    jest.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)
    const inB = sockets[1]!
    expect(inB.auth).toEqual({ token: 'token-b' })
    expect(inB.emitted.some((e) => e.event === 'project:join')).toBe(false)
    const other = 'b2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
    useProjectStore.setState({ currentProjectId: other })
    expect(inB.emitted.filter((e) => e.event === 'project:join').pop()!.payload).toEqual({ projectId: other })
    // The old socket was never asked to leave or join anything after the freeze.
    expect(inA.emitted.filter((e) => e.event === 'project:join' || e.event === 'project:leave')).toHaveLength(1)
  })
})
