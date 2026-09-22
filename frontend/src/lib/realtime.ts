import {
  io,
  type ManagerOptions,
  type Socket,
  type SocketOptions,
} from 'socket.io-client'

/**
 * Realtime client for the authenticated socket.io transport.
 *
 * One socket per browser session. The access token is sent in the handshake
 * (same token as REST). Project rooms are joined on demand and re-joined after
 * every reconnect. Subscribers receive `domain.event` messages; TanStack Query
 * invalidation is layered on top in `@/hooks/use-realtime`.
 */

export type DomainEventType =
  | 'record.changed'
  | 'approval.decided'
  | 'notification.created'
  | 'job.progress'

export interface DomainEvent {
  id: string
  type: DomainEventType | (string & {})
  orgId: string
  projectId: string | null
  entityType: string | null
  entityId: string | null
  action: string | null
  actorId: string | null
  occurredAt: string
  payload: Record<string, unknown>
}

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected'

type EventListener = (event: DomainEvent) => void
type StatusListener = (status: RealtimeStatus) => void

const resolveSocketUrl = (): string | undefined => {
  const explicit = import.meta.env.VITE_SOCKET_URL as string | undefined
  if (explicit) return explicit.replace(/\/$/, '')

  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl && /^https?:\/\//i.test(apiUrl)) {
    try {
      return new URL(apiUrl).origin
    } catch {
      return undefined
    }
  }

  return undefined
}

/**
 * Connection options (the token is added per connection).
 *
 * WebSocket only, like the mobile app. The API runs as several tasks behind
 * a load balancer without sticky sessions; socket.io's default of long-polling
 * first sends the handshake and the following polls to different tasks, which
 * answer "Session ID unknown", and the client loops through reconnects. A
 * WebSocket is one connection pinned to one task. The server still accepts
 * polling for older clients.
 */
export const REALTIME_SOCKET_OPTIONS: Partial<ManagerOptions & SocketOptions> = {
  transports: ['websocket'],
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
}

class RealtimeClient {
  private socket: Socket | null = null
  private token = ''
  private readonly listeners = new Set<EventListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly joinedProjects = new Set<string>()
  private teardownTimer: ReturnType<typeof setTimeout> | null = null
  status: RealtimeStatus = 'disconnected'

  connect(token: string) {
    if (!token) {
      this.disconnect()
      return
    }

    // A connect straight after a disconnect is the same component mounting
    // again (React StrictMode does this on every page load in development):
    // keep the socket rather than close one that is still opening.
    this.cancelTeardown()

    if (this.socket) {
      if (this.token === token) return
      this.token = token
      this.socket.auth = { token }
      if (this.socket.connected) {
        this.socket.disconnect().connect()
      } else {
        this.socket.connect()
      }
      return
    }

    this.token = token
    this.setStatus('connecting')

    const socket = io(resolveSocketUrl(), {
      ...REALTIME_SOCKET_OPTIONS,
      auth: { token },
    })

    socket.on('connect', () => {
      this.setStatus('connected')
      for (const projectId of this.joinedProjects) {
        socket.emit('project:join', { projectId })
      }
    })
    socket.on('disconnect', (reason) => {
      this.setStatus('disconnected')
      // The server drops a person's sockets when their role or standing
      // changes (CX21-491); the client does not reconnect on its own after a
      // server-side disconnect, so it reconnects here — the handshake carries
      // the account as it is now, and refuses it if it is no longer active.
      if (reason === 'io server disconnect' && this.socket === socket) {
        window.setTimeout(() => {
          if (this.socket === socket && !socket.connected) socket.connect()
        }, 1000)
      }
    })
    socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
      const code = error?.data?.code
      if (code === 'USER_INACTIVE' || code === 'INVALID_TOKEN') {
        // nothing to retry with this token: the account is gone or the token is not honoured
        this.disconnect()
        return
      }
      this.setStatus('connecting')
    })
    socket.io.on('reconnect_attempt', () => this.setStatus('connecting'))
    socket.on('domain.event', (event: DomainEvent) => {
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch (error) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.error('[realtime] listener failure', error)
          }
        }
      }
    })

    this.socket = socket
  }

  /**
   * Closes the socket — one task later, not at once.
   *
   * Closing a WebSocket that is still opening makes the browser log
   * "WebSocket is closed before the connection is established", and with the
   * transport now WebSocket-only that is exactly what an unmount followed by
   * an immediate remount did. Long-polling hid it: an aborted request is
   * silent. Deferring the close by one task lets a remount's connect() keep
   * the socket; a real sign-out still closes it straight after.
   */
  disconnect() {
    if (!this.socket) {
      this.token = ''
      this.setStatus('disconnected')
      return
    }
    if (this.teardownTimer !== null) return
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null
      this.closeNow()
    }, 0)
  }

  private cancelTeardown() {
    if (this.teardownTimer === null) return
    clearTimeout(this.teardownTimer)
    this.teardownTimer = null
  }

  private closeNow() {
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.io.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    this.token = ''
    this.setStatus('disconnected')
  }

  joinProject(projectId: string) {
    if (!projectId) return
    this.joinedProjects.add(projectId)
    if (this.socket?.connected) {
      this.socket.emit('project:join', { projectId })
    }
  }

  leaveProject(projectId: string) {
    if (!projectId) return
    this.joinedProjects.delete(projectId)
    if (this.socket?.connected) {
      this.socket.emit('project:leave', { projectId })
    }
  }

  subscribe(listener: EventListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private setStatus(status: RealtimeStatus) {
    if (this.status === status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }
}

export const realtime = new RealtimeClient()
