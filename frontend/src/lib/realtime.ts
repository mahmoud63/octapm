import { io, type Socket } from 'socket.io-client'

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

class RealtimeClient {
  private socket: Socket | null = null
  private token = ''
  private readonly listeners = new Set<EventListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly joinedProjects = new Set<string>()
  status: RealtimeStatus = 'disconnected'

  connect(token: string) {
    if (!token) {
      this.disconnect()
      return
    }

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
      auth: { token },
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('connect', () => {
      this.setStatus('connected')
      for (const projectId of this.joinedProjects) {
        socket.emit('project:join', { projectId })
      }
    })
    socket.on('disconnect', () => this.setStatus('disconnected'))
    socket.on('connect_error', () => this.setStatus('connecting'))
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

  disconnect() {
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
