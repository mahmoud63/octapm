/**
 * Site-reporting and schedule calls (M3): the daily log and its entries,
 * activities and progress submissions, lookahead item status, photos and
 * timesheets. Writes that the server can replay carry a clientRequestId.
 */
import { api, run } from '@/api/client'
import type {
  Activity,
  Crew,
  DailyLog,
  DailyLogDay,
  DailyLogSection,
  DailyLogSettings,
  EntryInput,
  Lookahead,
  LookaheadItem,
  Photo,
  PhotosPage,
  ProgressInput,
  ProgressMethod,
  ProgressSubmission,
  Timesheet,
  TimesheetEntry,
  Worker,
} from '@/api/site-types'

type Query = Record<string, string | number | boolean | undefined>
type PathParams = Record<string, string>

const get = <T>(path: string, options: { path?: PathParams; query?: Query; signal?: AbortSignal } = {}) =>
  run<T>(() => api.GET(path as never, { params: { path: options.path, query: options.query }, signal: options.signal } as never) as never)

const send = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, options: { path?: PathParams; body?: unknown } = {}) =>
  run<T>(() => (api[method] as typeof api.POST)(path as never, { params: { path: options.path }, body: options.body } as never) as never)

// ── Daily log ──

export const getDailyLogSettings = (projectId: string, signal?: AbortSignal) => get<DailyLogSettings>('/projects/{projectId}/daily-logs/settings', { path: { projectId }, signal })

export const listDailyLogDays = (projectId: string, from: string, to: string, signal?: AbortSignal) =>
  get<{ from: string; to: string; items: DailyLogDay[] }>('/projects/{projectId}/daily-logs', { path: { projectId }, query: { from, to }, signal })

export const getDailyLog = (projectId: string, date: string, signal?: AbortSignal) => get<DailyLog>('/projects/{projectId}/daily-logs/{date}', { path: { projectId, date }, signal })

export const addDailyLogEntry = (projectId: string, date: string, section: DailyLogSection, body: EntryInput) =>
  send<DailyLog>('POST', '/projects/{projectId}/daily-logs/{date}/entries/{section}', { path: { projectId, date, section }, body })

export const updateDailyLogEntry = (projectId: string, date: string, section: DailyLogSection, entryId: string, body: Partial<EntryInput>) =>
  send<DailyLog>('PATCH', '/projects/{projectId}/daily-logs/{date}/entries/{section}/{entryId}', { path: { projectId, date, section, entryId }, body })

export const deleteDailyLogEntry = (projectId: string, date: string, section: DailyLogSection, entryId: string) =>
  send<DailyLog>('DELETE', '/projects/{projectId}/daily-logs/{date}/entries/{section}/{entryId}', { path: { projectId, date, section, entryId } })

export const copyPreviousDailyLog = (projectId: string, date: string, sections: DailyLogSection[]) =>
  send<DailyLog>('POST', '/projects/{projectId}/daily-logs/{date}/copy-previous', { path: { projectId, date }, body: { sections } })

export const submitDailyLog = (projectId: string, date: string) => send<DailyLog>('POST', '/projects/{projectId}/daily-logs/{date}/submit', { path: { projectId, date }, body: {} })

export const refreshDailyLogWeather = (projectId: string, date: string) => send<DailyLog>('POST', '/projects/{projectId}/daily-logs/{date}/weather/refresh', { path: { projectId, date }, body: {} })

export const updateDailyLogSummary = (projectId: string, date: string, body: { summary?: string; weather?: Record<string, unknown> }) =>
  send<DailyLog>('PATCH', '/projects/{projectId}/daily-logs/{date}', { path: { projectId, date }, body })

// ── Activities and progress ──

export const listActivitiesFull = (projectId: string, signal?: AbortSignal) => get<Activity[]>('/projects/{projectId}/activities', { path: { projectId }, signal })

export const getActivity = (projectId: string, activityId: string, signal?: AbortSignal) => get<Activity>('/projects/{projectId}/activities/{id}', { path: { projectId, id: activityId }, signal })

export const getProgressMethod = (projectId: string, activityId: string, signal?: AbortSignal) =>
  get<ProgressMethod>('/projects/{projectId}/activities/{id}/progress-method', { path: { projectId, id: activityId }, signal })

export const listProgressSubmissions = (projectId: string, activityId: string, signal?: AbortSignal) =>
  get<ProgressSubmission[]>('/projects/{projectId}/activities/{id}/progress-submissions', { path: { projectId, id: activityId }, signal })

export const submitProgress = (projectId: string, activityId: string, body: ProgressInput) =>
  send<ProgressSubmission>('POST', '/projects/{projectId}/activities/{id}/progress', { path: { projectId, id: activityId }, body })

// ── Lookaheads ──

export const listLookaheads = (projectId: string, signal?: AbortSignal) =>
  get<{ items: Lookahead[]; summary: { count: number; currentId: string | null; openConstraints: number } }>('/projects/{projectId}/lookaheads', { path: { projectId }, query: { status: 'published' }, signal })

export const getLookahead = (projectId: string, lookaheadId: string, signal?: AbortSignal) =>
  get<Lookahead & { items: LookaheadItem[] }>('/projects/{projectId}/lookaheads/{lookaheadId}', { path: { projectId, lookaheadId }, signal })

export const setLookaheadItemStatus = (projectId: string, lookaheadId: string, itemId: string, body: { status: string; varianceReason?: string; pctComplete?: number; notes?: string }) =>
  send<LookaheadItem>('POST', '/projects/{projectId}/lookaheads/{lookaheadId}/items/{itemId}/status', { path: { projectId, lookaheadId, itemId }, body })

// ── Photos ──

export const listPhotos = (projectId: string, filters: { search?: string; tag?: string; locationId?: string; recordType?: string; recordId?: string; cursor?: string } = {}, signal?: AbortSignal) =>
  get<PhotosPage>('/projects/{projectId}/photos', { path: { projectId }, query: { limit: 60, search: filters.search || undefined, tag: filters.tag, locationId: filters.locationId, recordType: filters.recordType, recordId: filters.recordId, cursor: filters.cursor }, signal })

export const updatePhoto = (projectId: string, photoId: string, body: { caption?: string; tags?: string[]; locationId?: string | null; takenAt?: string }) =>
  send<Photo>('PATCH', '/projects/{projectId}/photos/{photoId}', { path: { projectId, photoId }, body })

export const photoThumbnailPath = (projectId: string, photoId: string) => `/projects/${projectId}/photos/${photoId}/thumbnail`
export const photoFilePath = (projectId: string, photoId: string) => `/projects/${projectId}/photos/${photoId}/file`

// ── Timesheets ──

export const listTimesheets = (projectId: string, filters: { from?: string; to?: string; status?: string } = {}, signal?: AbortSignal) =>
  get<{ items: Timesheet[]; summary: { count: number; regularHours: number; overtimeHours: number; byStatus: Record<string, number> } }>('/projects/{projectId}/timesheets', { path: { projectId }, query: { from: filters.from, to: filters.to, status: filters.status }, signal })

export const getTimesheet = (projectId: string, timesheetId: string, signal?: AbortSignal) => get<Timesheet>('/projects/{projectId}/timesheets/{timesheetId}', { path: { projectId, timesheetId }, signal })

export const listCrews = (projectId: string, signal?: AbortSignal) => get<{ items: Crew[] }>('/projects/{projectId}/timesheets/crews', { path: { projectId }, signal })

export const listWorkers = (projectId: string, signal?: AbortSignal) => get<{ items: Worker[] }>('/projects/{projectId}/timesheets/workers', { path: { projectId }, signal })

export const createTimesheet = (projectId: string, body: { date: string; crewId?: string; companyId?: string; notes?: string; defaultHours?: number; clientRequestId: string; entries: TimesheetEntry[] }) =>
  send<Timesheet & { replayed?: boolean }>('POST', '/projects/{projectId}/timesheets', { path: { projectId }, body })

export const submitTimesheet = (projectId: string, timesheetId: string) => send<Timesheet>('POST', '/projects/{projectId}/timesheets/{timesheetId}/submit', { path: { projectId, timesheetId }, body: {} })
