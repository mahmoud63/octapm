import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type NotificationCategory =
  | 'assignment'
  | 'due'
  | 'overdue'
  | 'approval'
  | 'commercial'
  | 'quality'
  | 'safety'
  | 'task'
  | 'workflow'

export interface NotificationDeliveryAttempt {
  id: string
  notificationId: string
  channel: 'email'
  provider?: string | null
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  attemptNumber: number
  errorCode?: string | null
  errorMessage?: string | null
  nextAttemptAt?: string | null
  sentAt?: string | null
  createdAt?: string | null
}

export interface NotificationItem {
  id: string
  projectId?: string | null
  actorId?: string | null
  type: string
  category: NotificationCategory
  event: string
  title: string
  message: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'unread' | 'read' | 'archived'
  readAt?: string | null
  archivedAt?: string | null
  dueAt?: string | null
  actionUrl?: string | null
  entityType?: string | null
  entityId?: string | null
  deliveryAttempts?: NotificationDeliveryAttempt[]
  createdAt: string
}

export interface NotificationPreference {
  id?: string | null
  category: NotificationCategory
  inAppEnabled: boolean
  emailEnabled: boolean
  digestEnabled: boolean
  dueSoonDays: number
  quietHoursStart?: string | null
  quietHoursEnd?: string | null
}

export const notificationCategories: NotificationCategory[] = [
  'assignment',
  'due',
  'overdue',
  'approval',
  'commercial',
  'quality',
  'safety',
  'task',
  'workflow',
]

export const notificationsKey = ['notifications'] as const
export const notificationSummaryKey = [...notificationsKey, 'summary'] as const
export const notificationPreferencesKey = [
  ...notificationsKey,
  'preferences',
] as const

export function useNotifications(status: 'active' | 'unread' = 'active') {
  return useQuery<{
    rows: NotificationItem[]
    pagination: { limit: number; nextCursor: string | null }
  }>({
    queryKey: [...notificationsKey, status],
    queryFn: () =>
      apiClient
        .get('/notifications', { params: { status, limit: 10 } })
        .then((response) => response.data.data),
  })
}

export function useNotificationSummary() {
  return useQuery<{
    unread: number
    read: number
    archived: number
    recent: NotificationItem[]
  }>({
    queryKey: notificationSummaryKey,
    queryFn: () =>
      apiClient
        .get('/notifications/summary')
        .then((response) => response.data.data),
    refetchInterval: 60_000,
  })
}

export function useNotificationPreferences() {
  return useQuery<{ preferences: NotificationPreference[] }>({
    queryKey: notificationPreferencesKey,
    queryFn: () =>
      apiClient
        .get('/notifications/preferences')
        .then((response) => response.data.data),
  })
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (preferences: NotificationPreference[]) =>
      apiClient
        .put('/notifications/preferences', { preferences })
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationPreferencesKey })
    },
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ id, read = true }: { id: string; read?: boolean }) =>
      apiClient
        .patch(`/notifications/${id}/read`, { read })
        .then((response) => response.data.data as NotificationItem),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKey })
      qc.invalidateQueries({ queryKey: notificationSummaryKey })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiClient
        .post('/notifications/mark-read')
        .then((response) => response.data.data as { updated: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKey })
      qc.invalidateQueries({ queryKey: notificationSummaryKey })
    },
  })
}
