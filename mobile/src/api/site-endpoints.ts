/**
 * Site-reporting and schedule calls (M3): the daily log and its entries,
 * activities and progress submissions, lookahead item status, photos and
 * timesheets. Writes that the server can replay carry a clientRequestId.
 */
import { api, run } from '@/api/client'
import { isAppError, looksTechnical } from '@/api/errors'
import {
  QUANTITY_FIGURE_KEYS,
  type Activity,
  type ActivityQuantities,
  type ActivityQuantitiesAnswer,
  type AllocatedItem,
  type AllocatedItemsAnswer,
  type Crew,
  type DailyLog,
  type DailyLogDay,
  type DailyLogSection,
  type DailyLogSettings,
  type EntryInput,
  type Lookahead,
  type LookaheadItem,
  type Photo,
  type PhotosPage,
  type ProgressInput,
  type ProgressMethod,
  type ProgressSubmission,
  type QuantityProgressEntry,
  type Timesheet,
  type TimesheetEntry,
  type Worker,
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

/** One line of the server's picker (GET /activities/{id}/allocated-items); only what the form needs is read. */
interface AllocatedItemRow {
  id: string
  description: string
  unit?: string | null
  unitCode?: string | null
  /** Withheld, with the allocation and its quantity, from a member who may not read the BOQ. */
  code?: string | null
  allocationId?: string | null
  allocatedQuantity?: number | null
}

/**
 * The items the site may record an installed quantity against: the BOQ
 * items the activity has an approved allocation of, read from the server's
 * own picker — GET /projects/{id}/activities/{activityId}/allocated-items,
 * admitted on reading progress (PC-6 §4.1, the owner's decision: a person on
 * site records without reading the bill). The server gives every such
 * reader the item's id, description and unit; the code, the allocation and
 * the allocated quantity only to a member who may read the BOQ — so those
 * are read when sent and never invented. A refusal of the whole read comes
 * back as `notAvailable` with the server's own reason.
 */
export const listAllocatedItems = async (projectId: string, activityId: string, signal?: AbortSignal): Promise<AllocatedItemsAnswer> => {
  try {
    const data = await get<{ items?: AllocatedItemRow[] }>('/projects/{projectId}/activities/{id}/allocated-items', { path: { projectId, id: activityId }, signal })
    const items: AllocatedItem[] = (data.items ?? []).map((row) => ({
      id: row.id,
      boqItemId: row.id,
      allocationId: row.allocationId ?? null,
      description: row.description,
      unit: row.unit ?? null,
      unitCode: row.unitCode ?? row.unit ?? null,
      code: row.code || null,
      plannedQuantity: row.allocatedQuantity ?? null,
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

/**
 * The views server's answer as the app reads it. The six figures sit under
 * `figures` (quantity-views.service folds them there; they are never at the
 * top level), and a member the server withholds the bill from gets
 * `withheld: true` with the reason at the top — that becomes the answer's
 * `notAvailable`, so a dash and the server's reason stand in for every
 * figure. A figure the server did send — a genuine 0 received, a figure with
 * its own `notAvailable` reason — is passed through as it came, reason and
 * all: the app never substitutes its own sentence for the server's.
 */
export const readActivityQuantities = (answer: ActivityQuantitiesAnswer | null | undefined): ActivityQuantities => {
  const figures = answer?.figures && typeof answer.figures === 'object' ? answer.figures : {}
  const read: ActivityQuantities = {}
  for (const key of QUANTITY_FIGURE_KEYS) if (key in figures) read[key] = figures[key] ?? null
  read.notAvailable = answer?.withheld ? { reason: answer.reason || 'Not available' } : null
  read.progressSource = answer?.progress && answer.progress.allowed ? (answer.progress.progressSource ?? null) : null
  return read
}

/** The five quantities and the committed one for an activity (views contract), each with its truth, basis and unit — or the reason it is not available. */
export const getActivityQuantities = async (projectId: string, activityId: string, signal?: AbortSignal): Promise<ActivityQuantities> =>
  readActivityQuantities(await get<ActivityQuantitiesAnswer>('/projects/{projectId}/activities/{id}/quantities', { path: { projectId, id: activityId }, signal }))

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
