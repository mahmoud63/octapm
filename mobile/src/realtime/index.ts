/**
 * Realtime invalidation over the server's socket.io transport.
 *
 * The socket presents the access token in its handshake, joins the current
 * project's room (the server applies the same project access check as the
 * REST layer) and listens for `domain.event`. Every event names the project
 * and record it touched; the app does not apply the event's payload to its
 * cache — it marks the project's queries stale and lets the screens that are
 * open refetch, so what is shown always comes from the API. Events are
 * coalesced for a moment so a burst of changes causes one refetch.
 *
 * The socket follows the session: it connects when the person is signed in,
 * carries a fresh token after every refresh, and disconnects when the session
 * ends. Nothing here is required for correctness; without a socket the
 * screens still refetch on focus and on pull.
 */
import { AppState, type AppStateStatus } from 'react-native'
import { io, type Socket } from 'socket.io-client'
import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { keys, queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'
import { useProjectStore } from '@/projects/store'
import { log } from '@/utilities/logger'

export const DOMAIN_EVENT = 'domain.event'
const COALESCE_MS = 400

export interface DomainEventMessage {
  type: string
  projectId?: string | null
  entityType?: string | null
  entityId?: string | null
  action?: string | null
  occurredAt?: string
  payload?: unknown
}

interface RealtimeState {
  connected: boolean
  /** Project room the socket has joined, or null. */
  room: string | null
  lastEventAt: string | null
}

export const useRealtimeStore = create<RealtimeState>(() => ({ connected: false, room: null, lastEventAt: null }))

/** The query key groups an event makes stale. Exposed for tests; the socket calls it after coalescing. */
export function invalidateForEvent(client: QueryClient, event: DomainEventMessage): string[] {
  const touched: string[] = []
  if (event.entityType === 'background_job') return touched
  if (event.type === 'notification.created') {
    void client.invalidateQueries({ queryKey: keys.notifications })
    void client.invalidateQueries({ queryKey: ['needs-you'] })
    touched.push('notifications', 'needs-you')
    return touched
  }
  if (event.projectId) {
    void client.invalidateQueries({ queryKey: keys.projectScoped(event.projectId), refetchType: 'active' })
    void client.invalidateQueries({ queryKey: keys.needsYou(event.projectId) })
    touched.push(`project:${event.projectId}`)
  }
  if (event.entityType === 'task') {
    // Tasks are cached across projects.
    void client.invalidateQueries({ queryKey: keys.tasks })
    touched.push('tasks')
  }
  if (event.type === 'approval.decided') {
    void client.invalidateQueries({ queryKey: ['workflow', 'my-steps'] })
    touched.push('my-steps')
  }
  return touched
}

let socket: Socket | null = null
let started = false
let joined: string | null = null
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; event: DomainEventMessage }>()

const coalesce = (event: DomainEventMessage) => {
  const key = event.type === 'notification.created' ? 'notifications' : `${event.type}:${event.projectId ?? 'none'}`
  const existing = pending.get(key)
  if (existing) clearTimeout(existing.timer)
  const timer = setTimeout(() => {
    pending.delete(key)
    invalidateForEvent(queryClient, event)
  }, COALESCE_MS)
  pending.set(key, { timer, event })
}

const joinProject = (projectId: string | null) => {
  if (!socket?.connected) return
  if (joined === projectId) return
  if (joined) {
    socket.emit('project:leave', { projectId: joined })
    joined = null
    useRealtimeStore.setState({ room: null })
  }
  if (!projectId) return
  const wanted = projectId
  socket.emit('project:join', { projectId: wanted }, (ack?: { ok?: boolean; code?: string }) => {
    if (ack?.ok) {
      joined = wanted
      useRealtimeStore.setState({ room: wanted })
    } else {
      log.warn('sync', 'realtime project room refused', { projectId: wanted, code: ack?.code ?? 'unknown' })
    }
  })
}

const connect = (token: string) => {
  if (socket) {
    socket.auth = { token }
    if (!socket.connected) socket.connect()
    return
  }
  socket = io(env.apiOrigin, { auth: { token }, transports: ['websocket'], reconnection: true, reconnectionDelayMax: 30_000, autoConnect: true })
  socket.on('connect', () => {
    joined = null
    useRealtimeStore.setState({ connected: true })
    joinProject(useProjectStore.getState().currentProjectId)
  })
  socket.on('disconnect', () => {
    joined = null
    useRealtimeStore.setState({ connected: false, room: null })
  })
  socket.on('connect_error', (error: Error) => {
    log.debug('sync', 'realtime connect error', { message: error.message })
  })
  socket.on(DOMAIN_EVENT, (message: DomainEventMessage) => {
    if (!message || typeof message !== 'object') return
    useRealtimeStore.setState({ lastEventAt: new Date().toISOString() })
    coalesce(message)
  })
}

const disconnect = () => {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  joined = null
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
  useRealtimeStore.setState({ connected: false, room: null })
}

const follow = () => {
  const { status, accessToken } = useAuthStore.getState()
  if (status === 'signedIn' && accessToken) connect(accessToken)
  else disconnect()
}

/** Start following the session and the current project. Returns a stop function. */
export function startRealtime(): () => void {
  if (started) return () => undefined
  started = true
  const stopAuth = useAuthStore.subscribe(follow)
  const stopProject = useProjectStore.subscribe((state) => joinProject(state.currentProjectId))
  const appState = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active' && socket && !socket.connected) socket.connect()
  })
  follow()
  return () => {
    stopAuth()
    stopProject()
    appState.remove()
    disconnect()
    started = false
  }
}

/** Test hook. */
export const __realtimeForTests = { socket: () => socket, joined: () => joined, reset: () => disconnect() }
