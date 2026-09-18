/**
 * The calls the app makes, one function each, all through the request layer.
 *
 * Screens never build URLs or read envelopes; they call these. Paths are the
 * API's own, with `{projectId}` substituted by the client, so a wrong path is
 * a compile-time error against the generated spec wherever the spec names it.
 */
import { api, run } from '@/api/client'
import type {
  Assignments,
  Health,
  Notification,
  NotificationPreference,
  NotificationsPage,
  NotificationSummary,
  Page,
  PermissionMatrix,
  Project,
  SearchResponse,
  WorkspaceDashboard,
} from '@/api/types'

type Query = Record<string, string | number | boolean | undefined>

const get = <T>(path: string, options: { path?: Record<string, string>; query?: Query; signal?: AbortSignal } = {}) =>
  run<T>(() => api.GET(path as never, { params: { path: options.path, query: options.query }, signal: options.signal } as never) as never)

const send = <T>(method: 'POST' | 'PATCH' | 'PUT', path: string, options: { path?: Record<string, string>; body?: unknown } = {}) =>
  run<T>(() => (api[method] as typeof api.POST)(path as never, { params: { path: options.path }, body: options.body } as never) as never)

// ── Projects ──

export const listProjects = (signal?: AbortSignal) => get<Page<Project>>('/projects', { query: { limit: 100 }, signal })

export const getProject = (projectId: string, signal?: AbortSignal) => get<Project>('/projects/{projectId}', { path: { projectId }, signal })

export const getWorkspace = (signal?: AbortSignal) => get<WorkspaceDashboard>('/projects/workspace-dashboard', { signal })

export const getAssignments = (projectId: string, signal?: AbortSignal) =>
  get<Assignments>('/projects/{projectId}/assignments/mine', { path: { projectId }, query: { limit: 200 }, signal })

export const getHealth = (projectId: string, signal?: AbortSignal) => get<Health>('/projects/{projectId}/health', { path: { projectId }, signal })

export const getPermissions = (projectId: string | null, signal?: AbortSignal) =>
  get<PermissionMatrix>('/auth/me/permissions', { query: projectId ? { projectId } : {}, signal })

// ── Notifications ──

export const listNotifications = (options: { status?: 'active' | 'all' | 'unread' | 'read' | 'archived'; cursor?: string; projectId?: string; limit?: number } = {}, signal?: AbortSignal) =>
  get<NotificationsPage>('/notifications', { query: { limit: options.limit ?? 50, status: options.status, cursor: options.cursor, projectId: options.projectId }, signal })

export const getNotificationSummary = (signal?: AbortSignal) => get<NotificationSummary>('/notifications/summary', { signal })

export const setNotificationRead = (notificationId: string, read = true) =>
  send<Notification>('PATCH', '/notifications/{notificationId}/read', { path: { notificationId }, body: { read } })

export const archiveNotification = (notificationId: string) => send<Notification>('PATCH', '/notifications/{notificationId}/archive', { path: { notificationId } })

export const markAllNotificationsRead = () => send<{ updated?: number }>('POST', '/notifications/mark-read')

export const getNotificationPreferences = (signal?: AbortSignal) => get<{ preferences: NotificationPreference[] }>('/notifications/preferences', { signal })

export const updateNotificationPreferences = (preferences: Partial<NotificationPreference>[]) =>
  send<{ preferences: NotificationPreference[] }>('PUT', '/notifications/preferences', { body: { preferences } })

// ── Search ──

export const search = (term: string, options: { types?: string[]; projectId?: string; limit?: number } = {}, signal?: AbortSignal) =>
  get<SearchResponse>('/search', { query: { q: term, types: options.types?.join(','), projectId: options.projectId, limit: options.limit ?? 30 }, signal })
