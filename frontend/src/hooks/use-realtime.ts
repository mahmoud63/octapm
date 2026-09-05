import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { realtime, type DomainEvent, type RealtimeStatus } from '@/lib/realtime'

/**
 * Query keys that are not scoped by project id but still change when a project
 * record changes (queues, portfolio lists, notifications).
 */
const GLOBAL_QUERY_KEYS: readonly string[][] = [
  ['workspace-dashboard'],
  ['projects'],
  ['tasks'],
  ['notifications'],
]

export const invalidateForEvent = (
  queryClient: QueryClient,
  event: DomainEvent,
  projectId?: string | null
) => {
  const scopeId = event.projectId ?? projectId ?? null

  if (event.type === 'notification.created') {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
    queryClient.invalidateQueries({ queryKey: ['workspace-dashboard'] })
    return
  }

  if (scopeId) {
    // Every project-scoped hook in the app keys its queries as [name, projectId, ...].
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) && query.queryKey[1] === scopeId,
    })
  }

  for (const key of GLOBAL_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: key })
  }
}

const subscribeStatus = (onChange: () => void) =>
  realtime.onStatus(() => onChange())
const getStatus = () => realtime.status

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus)
}

/**
 * Keeps the socket connected while a session exists. Mount once in the
 * authenticated layout.
 */
export function useRealtimeConnection() {
  const accessToken = useAuthStore((state) => state.auth.accessToken)
  const queryClient = useQueryClient()

  useEffect(() => {
    realtime.connect(accessToken)
  }, [accessToken])

  useEffect(() => {
    const unsubscribe = realtime.subscribe((event) => {
      if (event.type === 'notification.created') {
        invalidateForEvent(queryClient, event)
      }
    })
    return () => {
      unsubscribe()
    }
  }, [queryClient])

  useEffect(() => () => realtime.disconnect(), [])
}

/**
 * Joins the project room and refreshes every project-scoped query when a
 * record in that project changes. Mount in the project workspace.
 */
export function useProjectRealtime(projectId?: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!projectId) return undefined

    realtime.joinProject(projectId)
    const unsubscribe = realtime.subscribe((event) => {
      if (event.projectId !== projectId) return
      invalidateForEvent(queryClient, event, projectId)
    })

    return () => {
      unsubscribe()
      realtime.leaveProject(projectId)
    }
  }, [projectId, queryClient])
}
