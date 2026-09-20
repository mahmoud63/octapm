/**
 * Server state for the M1 screens, one hook per question a screen asks.
 *
 * Every project-scoped key sits under the project's key so that leaving the
 * project drops it. Mutations update the cache in place where the answer is
 * known, and invalidate the rest.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthenticated } from '@/auth/store'
import {
  archiveNotification,
  getAssignments,
  getHealth,
  getNotificationPreferences,
  getNotificationSummary,
  getProject,
  getWorkspace,
  listNotifications,
  listProjects,
  markAllNotificationsRead,
  search,
  setNotificationRead,
  updateNotificationPreferences,
  getForecast,
} from '@/api/endpoints'
import { keys } from '@/api/query'
import type { Notification, NotificationPreference, NotificationsPage } from '@/api/types'

export function useProjects() {
  const authed = useAuthenticated()
  return useQuery({ enabled: authed, queryKey: keys.projects, queryFn: ({ signal }) => listProjects(signal), select: (page) => page.items })
}

export function useProject(projectId: string | null) {
  return useQuery({ queryKey: keys.project(projectId ?? 'none'), queryFn: ({ signal }) => getProject(projectId!, signal), enabled: !!projectId })
}

export function useWorkspace() {
  const authed = useAuthenticated()
  return useQuery({ enabled: authed, queryKey: keys.workspace, queryFn: ({ signal }) => getWorkspace(signal) })
}

export function useAssignments(projectId: string | null) {
  return useQuery({ queryKey: keys.needsYou(projectId ?? undefined), queryFn: ({ signal }) => getAssignments(projectId!, signal), enabled: !!projectId })
}

export function useHealth(projectId: string | null) {
  return useQuery({ queryKey: keys.health(projectId ?? 'none'), queryFn: ({ signal }) => getHealth(projectId!, signal), enabled: !!projectId })
}

/** The server's schedule and cost forecast: SPI, CPI, EAC, slip and the named critical driver. */
export function useForecast(projectId: string | null) {
  return useQuery({ queryKey: keys.forecast(projectId ?? 'none'), queryFn: ({ signal }) => getForecast(projectId!, signal), enabled: !!projectId })
}

export function useNotifications(status: 'active' | 'unread' | 'all' = 'active') {
  const authed = useAuthenticated()
  return useQuery({ enabled: authed, queryKey: keys.notificationList(status), queryFn: ({ signal }) => listNotifications({ status }, signal) })
}

export function useNotificationSummary() {
  const authed = useAuthenticated()
  return useQuery({ enabled: authed, queryKey: keys.notificationSummary, queryFn: ({ signal }) => getNotificationSummary(signal), staleTime: 30_000 })
}

export function useNotificationPreferences() {
  const authed = useAuthenticated()
  return useQuery({ enabled: authed, queryKey: keys.notificationPreferences, queryFn: ({ signal }) => getNotificationPreferences(signal), select: (data) => data.preferences })
}

const patchRow = (page: NotificationsPage | undefined, id: string, patch: Partial<Notification>) =>
  page ? { ...page, rows: page.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) } : page

export function useNotificationActions() {
  const client = useQueryClient()
  const settle = () => {
    void client.invalidateQueries({ queryKey: keys.notifications })
  }

  const markRead = useMutation({
    mutationFn: ({ id, read = true }: { id: string; read?: boolean }) => setNotificationRead(id, read),
    onMutate: ({ id, read = true }) => {
      const patch: Partial<Notification> = { status: read ? 'read' : 'unread', readAt: read ? new Date().toISOString() : null }
      for (const status of ['active', 'unread', 'all'] as const) client.setQueryData<NotificationsPage>(keys.notificationList(status), (page) => patchRow(page, id, patch))
    },
    onSettled: settle,
  })

  const archive = useMutation({
    mutationFn: (id: string) => archiveNotification(id),
    onMutate: (id) => {
      for (const status of ['active', 'unread', 'all'] as const)
        client.setQueryData<NotificationsPage>(keys.notificationList(status), (page) => (page ? { ...page, rows: page.rows.filter((row) => row.id !== id) } : page))
    },
    onSettled: settle,
  })

  const markAllRead = useMutation({ mutationFn: () => markAllNotificationsRead(), onSettled: settle })

  const savePreferences = useMutation({
    mutationFn: (preferences: Partial<NotificationPreference>[]) => updateNotificationPreferences(preferences),
    onSuccess: (data) => client.setQueryData(keys.notificationPreferences, data),
  })

  return { markRead, archive, markAllRead, savePreferences }
}

export function useSearch(term: string, options: { types?: string[]; projectId?: string } = {}) {
  const trimmed = term.trim()
  return useQuery({
    queryKey: keys.search(`${trimmed}|${options.types?.join(',') ?? ''}|${options.projectId ?? ''}`),
    queryFn: ({ signal }) => search(trimmed, options, signal),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
}
