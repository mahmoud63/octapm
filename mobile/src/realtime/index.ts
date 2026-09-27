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
/** However busy it gets, a change reaches the screen within this. */
const COALESCE_MAX_MS = 2_000

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
    // An approval landing in someone's inbox is announced as a notification and
    // nothing else: the bus has approval.decided but no event for a step being
    // raised. Without this the approvals list stays as it was until its own
    // half-minute runs out, so a change order submitted for your approval while
    // you are looking at the screen simply does not appear.
    void client.invalidateQueries({ queryKey: ['workflow', 'my-steps'] })
    touched.push('notifications', 'needs-you', 'my-steps')
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
  if (event.type === 'approval.decided' || event.entityType === 'approval_step' || event.entityType === 'workflow_instance') {
    void client.invalidateQueries({ queryKey: ['workflow', 'my-steps'] })
    touched.push('my-steps')
  }
  // Inventory is org-level, so its keys sit outside the project scope above.
  if (INVENTORY_ENTITIES.has(String(event.entityType))) {
    void client.invalidateQueries({ queryKey: ['inventory'] })
    touched.push('inventory')
  }
  return touched
}

/** Entity types whose change moves a stock balance, a movement list or a delivery. */
const INVENTORY_ENTITIES = new Set(['stock_transaction', 'stock_movement', 'inventory_item', 'stock_transfer', 'delivery_receipt', 'goods_receipt', 'procurement_order', 'purchase_order'])

let socket: Socket | null = null
let started = false
let joined: string | null = null
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; event: DomainEventMessage; startedAt: number }>()

const coalesce = (event: DomainEventMessage) => {
  const key = event.type === 'notification.created' ? 'notifications' : `${event.type}:${event.projectId ?? 'none'}`
  const existing = pending.get(key)
  // Each new event pushes the wait back, which is the point of coalescing — but
  // only up to a limit. A busy hour on a project can produce a change every few
  // hundred milliseconds, and without a ceiling the refresh is postponed for as
  // long as the work continues: exactly when the screen most needs to be right.
  const startedAt = existing?.startedAt ?? Date.now()
  if (existing) clearTimeout(existing.timer)
  const wait = Math.max(0, Math.min(COALESCE_MS, startedAt + COALESCE_MAX_MS - Date.now()))
  const timer = setTimeout(() => {
    pending.delete(key)
    invalidateForEvent(queryClient, event)
  }, wait)
  pending.set(key, { timer, event, startedAt })
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
      // Anything that changed before this room was joined — on a first load, or
      // across a reconnection — arrived nowhere. Without this the screen keeps
      // showing what it had when the signal went, and nothing ever tells it.
      void queryClient.invalidateQueries({ queryKey: keys.projectScoped(wanted), refetchType: 'active' })
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

/**
 * The socket follows the session. A workspace switch raises `switching`
 * first: the socket is dropped and its rooms forgotten while the token is
 * replaced, and when the flag falls a fresh socket connects with the new
 * token and joins the new workspace's project — never the old one's room
 * under the new token (workspace switching doc §3, steps 2 and 7).
 */
const follow = () => {
  const { status, accessToken, switching } = useAuthStore.getState()
  if (status === 'signedIn' && accessToken && !switching) connect(accessToken)
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
