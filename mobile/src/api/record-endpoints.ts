/**
 * The record calls from M2: RFIs, tasks, comments, history, attachments,
 * pickers, the document register and drawing sheets. Every state change goes
 * through the API's own transition route, never through an edit of the
 * status field, so the server applies its workflow rules and notifications.
 */
import { api, run } from '@/api/client'
import type {
  ActivityRow,
  AttachmentItem,
  AuditPage,
  Comment,
  CommentsPage,
  CustomFieldSchema,
  DrawingSheet,
  LocationNode,
  OfflineManifest,
  Register,
  RfiAction,
  RfiCreate,
  RfiDetail,
  RfiList,
  RfiResponse,
  SheetList,
  SheetPin,
  TaskComment,
  TaskCreate,
  TaskDetail,
  TaskList,
  TeamMember,
} from '@/api/record-types'

type Query = Record<string, string | number | boolean | undefined>
type PathParams = Record<string, string>

const get = <T>(path: string, options: { path?: PathParams; query?: Query; signal?: AbortSignal } = {}) =>
  run<T>(() => api.GET(path as never, { params: { path: options.path, query: options.query }, signal: options.signal } as never) as never)

const send = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, options: { path?: PathParams; body?: unknown } = {}) =>
  run<T>(() => (api[method] as typeof api.POST)(path as never, { params: { path: options.path }, body: options.body } as never) as never)

/** Multipart upload through the same request layer (bearer, client header, request id, refresh). */
const uploadForm = <T>(path: string, form: FormData, options: { path?: PathParams } = {}) =>
  run<T>(() => api.POST(path as never, { params: { path: options.path }, body: form, bodySerializer: (body: FormData) => body } as never) as never)

// ── RFIs ──

export interface RfiFilters {
  status?: string
  locationId?: string
  ballInCourt?: boolean
  overdue?: boolean
  search?: string
  cursor?: string
  limit?: number
}

export const listRfis = (projectId: string, filters: RfiFilters = {}, signal?: AbortSignal) =>
  get<RfiList>('/projects/{projectId}/rfi', {
    path: { projectId },
    query: {
      locationId: filters.locationId,
      limit: filters.limit ?? 50,
      status: filters.status,
      ballInCourtUserId: filters.ballInCourt ? 'me' : undefined,
      overdue: filters.overdue ? true : undefined,
      search: filters.search || undefined,
      cursor: filters.cursor,
      sortBy: 'updated',
      sortDir: 'desc',
    },
    signal,
  })

export const getRfi = (projectId: string, rfiId: string, signal?: AbortSignal) => get<RfiDetail>('/projects/{projectId}/rfi/{rfiId}', { path: { projectId, rfiId }, signal })

export const createRfi = (projectId: string, body: RfiCreate) => send<RfiDetail>('POST', '/projects/{projectId}/rfi', { path: { projectId }, body })

export const postRfiResponse = (projectId: string, rfiId: string, body: { body: string; isOfficial?: boolean }) =>
  send<RfiResponse>('POST', '/projects/{projectId}/rfi/{rfiId}/responses', { path: { projectId, rfiId }, body })

export const runRfiAction = (projectId: string, rfiId: string, action: RfiAction, body: Record<string, unknown> = {}) =>
  send<RfiDetail>('POST', `/projects/{projectId}/rfi/{rfiId}/${action}`, { path: { projectId, rfiId }, body })

export const convertRfiToChange = (projectId: string, rfiId: string, body: { description?: string; value?: number } = {}) =>
  send<{ changeOrder: { id: string; ref: string; status: string; path?: string }; rfi: RfiDetail }>('POST', '/projects/{projectId}/rfi/{rfiId}/convert-to-change', { path: { projectId, rfiId }, body })

// ── Tasks ──

export interface TaskFilters {
  mine?: boolean
  projectId?: string
  status?: string
  overdue?: boolean
  search?: string
  cursor?: string
  limit?: number
}

export const listTasks = (filters: TaskFilters = {}, signal?: AbortSignal) =>
  get<TaskList>('/tasks', {
    query: {
      limit: filters.limit ?? 50,
      assignee: filters.mine ? 'me' : undefined,
      projectId: filters.projectId,
      status: filters.status,
      overdue: filters.overdue ? true : undefined,
      search: filters.search || undefined,
      cursor: filters.cursor,
      sortBy: 'due',
      sortDir: 'asc',
    },
    signal,
  })

export const getTask = (taskId: string, signal?: AbortSignal) => get<TaskDetail>('/tasks/{id}', { path: { id: taskId }, signal })

export const createTask = (body: TaskCreate) => send<TaskDetail>('POST', '/tasks', { body })

export const updateTask = (taskId: string, body: Partial<TaskCreate>) => send<TaskDetail>('PATCH', '/tasks/{id}', { path: { id: taskId }, body })

export const closeTask = (taskId: string, comment?: string) => send<TaskDetail>('POST', '/tasks/{id}/close', { path: { id: taskId }, body: comment ? { comment } : {} })

export const addTaskComment = (taskId: string, body: string) => send<TaskComment>('POST', '/tasks/{id}/comments', { path: { id: taskId }, body: { body } })

// ── Comments and history (any commentable record) ──

export const listComments = (projectId: string, recordType: string, recordId: string, signal?: AbortSignal) =>
  get<CommentsPage>('/projects/{projectId}/comments', { path: { projectId }, query: { recordType, recordId, limit: 100, order: 'asc' }, signal })

export const postComment = (projectId: string, body: { recordType: string; recordId: string; body: string; parentId?: string }) =>
  send<Comment>('POST', '/projects/{projectId}/comments', { path: { projectId }, body })

export const listHistory = (projectId: string, entityType: string, entityId: string, signal?: AbortSignal) =>
  get<AuditPage>('/projects/{projectId}/audit', { path: { projectId }, query: { entityType, entityId, source: 'all', limit: 100, order: 'asc' }, signal })

// ── Attachments ──

export const listAttachments = (projectId: string, recordType: string, recordId: string, signal?: AbortSignal) =>
  get<{ items: AttachmentItem[] }>('/projects/{projectId}/attachments', { path: { projectId }, query: { recordType, recordId }, signal })

export interface AttachmentUpload {
  recordType: string
  recordId: string
  role?: 'attachment' | 'evidence' | 'photo' | 'reference' | 'signature'
  caption?: string
  /** Where on site this was taken. The gallery filters by the whole subtree. */
  locationId?: string | null
  tags?: string[]
  clientRequestId: string
  files: { uri: string; name: string; type: string }[] | File[]
}

export const uploadAttachments = (projectId: string, upload: AttachmentUpload) => {
  const form = new FormData()
  form.append('recordType', upload.recordType)
  form.append('recordId', upload.recordId)
  form.append('clientRequestId', upload.clientRequestId)
  if (upload.role) form.append('role', upload.role)
  if (upload.caption) form.append('caption', upload.caption)
  if (upload.locationId) form.append('locationId', upload.locationId)
  for (const tag of upload.tags ?? []) form.append('tags', tag)
  for (const file of upload.files) {
    // On native, fetch accepts { uri, name, type }; on the web target, a File.
    form.append('files', file as unknown as Blob)
  }
  return uploadForm<{ items: AttachmentItem[]; replayed?: boolean }>('/projects/{projectId}/attachments', form, { path: { projectId } })
}

// ── Pickers ──

export const listTeam = (projectId: string, signal?: AbortSignal) => get<{ items: TeamMember[] }>('/projects/{projectId}/team', { path: { projectId }, signal })

export const listLocations = (projectId: string, signal?: AbortSignal) => get<{ items: LocationNode[] }>('/projects/{projectId}/locations', { path: { projectId }, signal })

export const listActivities = (projectId: string, signal?: AbortSignal) => get<ActivityRow[]>('/projects/{projectId}/activities', { path: { projectId }, signal })

// ── Documents and drawings ──

export const getRegister = (projectId: string, filters: { folder?: string; search?: string; recordType?: string } = {}, signal?: AbortSignal) =>
  get<Register>('/projects/{projectId}/doc-control/register', { path: { projectId }, query: { folder: filters.folder, search: filters.search || undefined, recordType: filters.recordType }, signal })

export const listSheets = (projectId: string, filters: { search?: string; discipline?: string; status?: 'current' | 'obsolete' | 'all'; locationId?: string } = {}, signal?: AbortSignal) =>
  get<SheetList>('/projects/{projectId}/drawings/sheets', { path: { projectId }, query: { search: filters.search || undefined, discipline: filters.discipline, status: filters.status, locationId: filters.locationId }, signal })

export const getSheet = (projectId: string, sheetId: string, signal?: AbortSignal) => get<DrawingSheet & { revisions?: SheetRevisionHistory[] }>('/projects/{projectId}/drawings/sheets/{sheetId}', { path: { projectId, sheetId }, signal })

export interface SheetRevisionHistory {
  id: string
  revision: string
  status: string
  publishedAt: string | null
}

export const getOfflineManifest = (projectId: string, signal?: AbortSignal) =>
  get<OfflineManifest>('/projects/{projectId}/drawings/sheets/offline-manifest', { path: { projectId }, signal })

export const listSheetPins = (projectId: string, sheetId: string, signal?: AbortSignal) =>
  get<{ items: SheetPin[] } | SheetPin[]>('/projects/{projectId}/drawings/sheets/{sheetId}/pins', { path: { projectId, sheetId }, signal })

export const createSheetPin = (projectId: string, sheetId: string, body: { x: number; y: number; recordType: string; recordId?: string; create?: Record<string, unknown>; label?: string }) =>
  send<SheetPin>('POST', '/projects/{projectId}/drawings/sheets/{sheetId}/pins', { path: { projectId, sheetId }, body })

// ── Custom fields ──

export const getCustomFieldSchema = (projectId: string, recordType: string, signal?: AbortSignal) =>
  get<CustomFieldSchema>('/projects/{projectId}/custom-fields/schema', { path: { projectId }, query: { recordType }, signal })

export const getCustomFieldValues = (projectId: string, recordType: string, recordId: string, signal?: AbortSignal) =>
  get<{ values: Record<string, unknown> }>('/projects/{projectId}/custom-fields/values/{recordType}/{recordId}', { path: { projectId, recordType, recordId }, signal })

/** Where to fetch a file with the bearer; the API answers with a redirect to a short-lived URL. */
export const documentFilePath = (projectId: string, documentId: string) => `/projects/${projectId}/attachments/documents/${documentId}`
