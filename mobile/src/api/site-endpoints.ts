/**
 * Site-reporting and schedule calls (M3): the daily log and its entries,
 * activities and progress submissions, lookahead item status, photos and
 * timesheets. Writes that the server can replay carry a clientRequestId.
 */
import { api, run } from '@/api/client'
import { isAppError, looksTechnical } from '@/api/errors'
import type {
  Activity,
  ActivityQuantities,
  AllocatedItem,
  AllocatedItemsAnswer,
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
  QuantityProgressEntry,
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

/**
 * Every activity's progress in one call, each submission carrying its activity.
 *
 * The daily report needs the work recorded on one day, and an activity's own
 * `pendingProgress` only ever shows what is still waiting: read that way, work
 * disappeared from the report the moment it was approved.
 */
export const listProjectProgressSubmissions = (projectId: string, day?: string | null, signal?: AbortSignal) =>
  get<{ items: (ProgressSubmission & { activity?: { id: string; name: string; activityCode?: string | null } | null })[] }>(
    '/projects/{projectId}/activities/progress-submissions',
    { path: { projectId }, query: day ? { from: dayStartedAt(day), to: dayEndedAt(day) } : {}, signal },
  )

/**
 * A day on site is a local one. Eight in the evening in Baton Rouge is already
 * tomorrow in UTC, so the report asks the server for its own day as instants
 * rather than naming a date and hoping both ends agree what that means.
 */
const dayStartedAt = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 0, 0, 0, 0).toISOString()
}
const dayEndedAt = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).toISOString()
}

export const submitProgress = (projectId: string, activityId: string, body: ProgressInput) =>
  send<ProgressSubmission>('POST', '/projects/{projectId}/activities/{id}/progress', { path: { projectId, id: activityId }, body })

/** The review of a submitted update, through the server's own transitions; the approved figure is never written directly. */
export const approveProgressSubmission = (projectId: string, activityId: string, submissionId: string) =>
  send<ProgressSubmission>('POST', '/projects/{projectId}/activities/{id}/progress-submissions/{submissionId}/approve', { path: { projectId, id: activityId, submissionId }, body: {} })

export const rejectProgressSubmission = (projectId: string, activityId: string, submissionId: string, reason: string) =>
  send<ProgressSubmission>('POST', '/projects/{projectId}/activities/{id}/progress-submissions/{submissionId}/reject', { path: { projectId, id: activityId, submissionId }, body: { reason } })

// ── Quantities (PC-6) ──

/** An allocation row as the register lists it; only what the picker needs is read. */
interface AllocationRow {
  id: string
  boqItemId: string
  quantity: number | null
  unitCode: string | null
  boqItem: { id: string; code?: string | null; description: string; unit?: string | null; unitCode?: string | null } | null
}

/**
 * The items the site may record an installed quantity against: the approved
 * allocations of the activity, read from the allocation register — the one
 * list the server already keeps and already gates on reading the BOQ. The
 * answer carries each item's description and unit, and its code when the
 * server sent one; nothing is recomputed. A refusal is the server
 * withholding the bill from this reader (§12): it comes back as
 * `notAvailable` with the server's own reason, and no item is invented.
 */
export const listAllocatedItems = async (projectId: string, activityId: string, signal?: AbortSignal): Promise<AllocatedItemsAnswer> => {
  try {
    const data = await get<{ allocations: AllocationRow[] }>('/projects/{projectId}/activity-boq-allocations', { path: { projectId }, query: { activityId, status: 'approved' }, signal })
    const items: AllocatedItem[] = (data.allocations ?? [])
      .filter((row) => row.boqItem)
      .map((row) => ({
        id: row.boqItem!.id,
        boqItemId: row.boqItemId,
        allocationId: row.id,
        description: row.boqItem!.description,
        unitCode: row.unitCode ?? row.boqItem!.unitCode ?? row.boqItem!.unit ?? null,
        code: row.boqItem!.code || null,
        plannedQuantity: row.quantity ?? null,
      }))
    return { items, notAvailable: null }
  } catch (error) {
    // The server's own reason when it wrote one a person can read; the app's sentence otherwise.
    if (isAppError(error) && error.code === 'FORBIDDEN') return { items: [], notAvailable: { reason: error.message && error.message !== error.code && !looksTechnical(error.message) ? error.message : error.userMessage } }
    throw error
  }
}

/** The project's quantity progress entries (core contract: GET /projects/:id/quantity-progress), narrowed by activity, item or status. */
export const listQuantityProgress = async (projectId: string, filters: { activityId?: string; boqItemId?: string; status?: string } = {}, signal?: AbortSignal): Promise<QuantityProgressEntry[]> => {
  const data = await get<{ items?: QuantityProgressEntry[] } | QuantityProgressEntry[]>('/projects/{projectId}/quantity-progress', { path: { projectId }, query: { activityId: filters.activityId, boqItemId: filters.boqItemId, status: filters.status }, signal })
  return Array.isArray(data) ? data : (data.items ?? [])
}

/** The five quantities and the committed one for an activity (views contract), each with its truth, basis and unit — or the reason it is not available. */
export const getActivityQuantities = (projectId: string, activityId: string, signal?: AbortSignal) =>
  get<ActivityQuantities>('/projects/{projectId}/activities/{id}/quantities', { path: { projectId, id: activityId }, signal })

// ── Lookaheads ──

export const listLookaheads = (projectId: string, signal?: AbortSignal) =>
  get<{ items: Lookahead[]; summary: { count: number; currentId: string | null; openConstraints: number } }>('/projects/{projectId}/lookaheads', { path: { projectId }, query: { status: 'published' }, signal })

export const getConstraints = (projectId: string, signal?: AbortSignal) =>
  get<{ items: (LookaheadItem & { lookahead: { id: string; ref: string; title: string; status: string } | null })[]; summary: { open: number; overdue: number; dueThisWeek: number } }>(
    '/projects/{projectId}/lookaheads/constraints',
    { path: { projectId }, signal },
  )

export const getLookahead = (projectId: string, lookaheadId: string, signal?: AbortSignal) =>
  get<Lookahead & { items: LookaheadItem[] }>('/projects/{projectId}/lookaheads/{lookaheadId}', { path: { projectId, lookaheadId }, signal })

export const setLookaheadItemStatus = (projectId: string, lookaheadId: string, itemId: string, body: { status: string; varianceReason?: string; pctComplete?: number; notes?: string }) =>
  send<LookaheadItem>('POST', '/projects/{projectId}/lookaheads/{lookaheadId}/items/{itemId}/status', { path: { projectId, lookaheadId, itemId }, body })

// ── Photos ──

/** Everything the photo register can be narrowed by, as the route accepts it. */
export interface PhotoFilters {
  search?: string
  tag?: string
  locationId?: string
  recordType?: string
  recordId?: string
  /** ISO instants; the server filters on when the photograph was taken. */
  from?: string
  to?: string
  cursor?: string
}

export const listPhotos = (projectId: string, filters: PhotoFilters = {}, signal?: AbortSignal) =>
  get<PhotosPage>('/projects/{projectId}/photos', {
    path: { projectId },
    query: { limit: 60, search: filters.search || undefined, tag: filters.tag, locationId: filters.locationId, recordType: filters.recordType, recordId: filters.recordId, from: filters.from, to: filters.to, cursor: filters.cursor },
    signal,
  })

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
