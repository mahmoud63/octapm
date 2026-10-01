import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { apiClient } from '@/services/api/client'

/**
 * Project exceptions (PC-7b, change intelligence §1, §2, §6): reviewed
 * signals the engine derives from the figures their owning services state —
 * never a change order, never a budget or schedule change, never a figure
 * the web computes. The server decides what this caller may see (a BOQ-
 * derived exception is withheld WHOLE from a member without BOQ read, and
 * the answer says so with a reason, never with a count) and what this
 * caller may do (`actions`, one boolean per action). The web draws both as
 * sent: no arithmetic on `measured` / `limit`, no action the server did not
 * grant, no empty count when some were withheld.
 *
 * The contract is the API's (routes/exceptions.js, exception.service.js
 * serialize, change-event.service prefillFromRecord / raiseFromRecord):
 * every address the screens use is here, so it changes in one place.
 */

export type ExceptionSeverity = 'info' | 'warning' | 'critical'
export type ExceptionStatus =
  | 'open'
  | 'in_change'
  | 'snoozed'
  | 'dismissed'
  | 'resolved'

/** One of the two figures, exactly as the owning service stated it. */
export type ExceptionFigure = {
  value: number | null
  unitCode: string | null
  basis: string
}

export type ExceptionSubject = {
  type: string
  id: string
  label: string | null
}

export type ExceptionActions = {
  review: boolean
  snooze: boolean
  dismiss: boolean
  raiseChangeEvent: boolean
  associateChangeEvent: boolean
}

type GroupNode = { id: string; code: string | null; name: string | null } | null

export type ProjectException = {
  id: string
  projectId?: string
  kind: string
  /** The server's words for the kind. */
  kindLabel?: string | null
  severity: ExceptionSeverity
  status: ExceptionStatus
  module?: string
  subject: ExceptionSubject
  secondarySubject?: ExceptionSubject | null
  /** Structure the subject sits in (WBS, location, cost code), as the server names it. */
  group?: {
    wbsNodeId?: string | null
    wbsNode?: GroupNode
    locationId?: string | null
    location?: GroupNode
    costCodeId?: string | null
    costCode?: GroupNode
  } | null
  measured: ExceptionFigure
  limit: ExceptionFigure
  detectedAt: string | null
  lastSeenAt: string | null
  resolvedAt?: string | null
  /** Who reviewed it: the name is the server's; the id is never drawn. */
  review?: {
    reviewedAt: string | null
    reviewedBy: string | null
    reviewedByName: string | null
    note: string | null
  } | null
  snooze?: {
    until: string | null
    by: string | null
    byName: string | null
    reason: string | null
  } | null
  dismissal?: {
    at: string | null
    reason: string | null
    by: string | null
    byName: string | null
  } | null
  changeEvent?: {
    id: string
    ref: string
    status: string
    title?: string | null
    path?: string | null
  } | null
  actions: ExceptionActions
}

/** The server's marker for exceptions it withheld from this caller: a reason, never a count. */
export type ExceptionsWithheld = { reason: string; modules?: string[] }

/**
 * A list as the server answered it. `not-on-server` is the API's own
 * "route not found" (a server without PC-7b): said as that, never as an
 * empty list. `nextCursor` is set while the server has more pages.
 */
export type ExceptionList =
  | {
      state: 'ok'
      items: ProjectException[]
      withheld: ExceptionsWithheld | null
      nextCursor: string | null
    }
  | { state: 'not-on-server'; items: []; withheld: null; nextCursor: null }

export type SeverityCounts = Partial<Record<ExceptionSeverity, number>>

/** Open-exception counts per severity, as the server counted what this caller may see. */
export type ExceptionsSummary =
  | {
      state: 'ok'
      total: number | null
      bySeverity: SeverityCounts
      withheld: ExceptionsWithheld | null
    }
  | { state: 'not-on-server'; total: null; bySeverity: SeverityCounts; withheld: null }

export type ExceptionListQuery = {
  status?: string
  severity?: string
  kind?: string
  /**
   * Exceptions on one record: the API's subject filter, which also takes the
   * secondary subject and — for a BOQ item or an activity — its allocations.
   */
  subjectType?: string
  subjectId?: string
}

/** Where a change event can be raised from, and the typed link it carries (change intelligence §5). */
export type ChangeEventSourceType =
  | 'exception'
  | 'rfi'
  | 'daily_log'
  | 'ncr'
  | 'punch_item'
  | 'drawing_revision'
  | 'submittal'
  | 'meeting_action'

export type ChangeEventSource = { type: ChangeEventSourceType; id: string }

/** Where each source's routes live under /projects/:projectId (the API's SOURCE_MOUNTS). */
export const CHANGE_EVENT_SOURCE_MOUNTS: Record<ChangeEventSourceType, string> = {
  exception: 'controls/exceptions',
  rfi: 'rfi',
  daily_log: 'daily-logs',
  ncr: 'ncr',
  punch_item: 'punch',
  drawing_revision: 'drawings/sheets/revisions',
  submittal: 'submittals',
  meeting_action: 'meetings/action-items',
}

const exceptionsBase = (projectId: string) => `/projects/${projectId}/controls/exceptions`

export const EXCEPTION_ROUTES = {
  list: (projectId: string) => exceptionsBase(projectId),
  /** Open counts per severity for one project (to be declared by the API before /:exceptionId). */
  summary: (projectId: string) => `${exceptionsBase(projectId)}/summary`,
  action: (
    projectId: string,
    exceptionId: string,
    action: 'review' | 'snooze' | 'dismiss' | 'associate-change-event'
  ) => `${exceptionsBase(projectId)}/${exceptionId}/${action}`,
  /** The server's change-event prefill for a source (an exception, an RFI, a daily log …). */
  changeEventPrefill: (projectId: string, source: ChangeEventSource) =>
    `/projects/${projectId}/${CHANGE_EVENT_SOURCE_MOUNTS[source.type]}/${source.id}/change-event-prefill`,
  /** The handoff: ONE draft change event with the typed link to its source. */
  raiseChangeEvent: (projectId: string, source: ChangeEventSource) =>
    `/projects/${projectId}/${CHANGE_EVENT_SOURCE_MOUNTS[source.type]}/${source.id}/raise-change-event`,
}

export const exceptionKeys = {
  all: (projectId: string) => ['project-exceptions', projectId] as const,
  list: (projectId: string, query: ExceptionListQuery) =>
    ['project-exceptions', projectId, 'list', query] as const,
  summary: (projectId: string) =>
    ['project-exceptions', projectId, 'summary'] as const,
}

type ErrorBody = {
  error?: { code?: string; message?: string; details?: Array<{ field?: string; location?: string }> }
}

/**
 * The API's own "route not found" (error-handler notFoundHandler) — a server
 * without the route. Any other 404 (a project the caller cannot open, an
 * exception they may not read) is an error and is said as one.
 */
export const isRouteMissing = (error: unknown) => {
  if (!(error instanceof AxiosError) || error.response?.status !== 404) return false
  const body = (error.response.data ?? {}) as ErrorBody
  return body.error?.code === 'NOT_FOUND' && /^Route not found/.test(body.error.message ?? '')
}

/**
 * The summary address on an API whose exceptions router has no summary
 * route yet: `/summary` is read as an exception id and refused on that
 * parameter. Said as "not on this server", never as a count.
 */
const isSummaryMissing = (error: unknown) => {
  if (isRouteMissing(error)) return true
  if (!(error instanceof AxiosError) || error.response?.status !== 400) return false
  const body = (error.response.data ?? {}) as ErrorBody
  return (
    body.error?.code === 'VALIDATION_ERROR' &&
    (body.error.details ?? []).some(
      (detail) => detail.field === 'exceptionId' && detail.location === 'params'
    )
  )
}

const asWithheld = (value: unknown): ExceptionsWithheld | null => {
  if (!value || typeof value !== 'object') return null
  const marker = value as { reason?: unknown; modules?: unknown }
  return {
    reason: typeof marker.reason === 'string' && marker.reason ? marker.reason : 'Withheld',
    ...(Array.isArray(marker.modules)
      ? { modules: marker.modules.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
  }
}

type ListPage = Extract<ExceptionList, { state: 'ok' }>
type MissingList = Extract<ExceptionList, { state: 'not-on-server' }>
type PageOrMissing = ListPage | MissingList

/** One page: `{ success, data: { data: [...], pagination: { limit, nextCursor }, withheld? } }`. */
export const readExceptionPage = (body: unknown): ListPage => {
  const answer = (((body ?? {}) as { data?: unknown }).data ?? {}) as {
    data?: unknown
    pagination?: { nextCursor?: unknown }
    withheld?: unknown
  }
  const nextCursor = answer.pagination?.nextCursor
  return {
    state: 'ok',
    items: Array.isArray(answer.data) ? (answer.data as ProjectException[]) : [],
    withheld: asWithheld(answer.withheld),
    nextCursor: typeof nextCursor === 'string' && nextCursor ? nextCursor : null,
  }
}

/** The pages read so far, as one list: the last page says whether more remain. */
export const flattenExceptionPages = (
  data: InfiniteData<PageOrMissing, unknown> | undefined
): ExceptionList | undefined => {
  if (!data?.pages.length) return undefined
  const [first] = data.pages
  if (first.state === 'not-on-server') return first
  const pages = data.pages.filter((page): page is ListPage => page.state === 'ok')
  return {
    state: 'ok',
    items: pages.flatMap((page) => page.items),
    withheld: pages.find((page) => page.withheld)?.withheld ?? null,
    nextCursor: pages[pages.length - 1].nextCursor,
  }
}

export const EXCEPTION_PAGE_SIZE = 50

/**
 * The caller's exceptions, a page at a time (the API's cursor pages); read
 * the pages as one list with flattenExceptionPages(query.data).
 */
export const useProjectExceptions = (
  projectId: string,
  query: ExceptionListQuery = {},
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useInfiniteQuery({
    queryKey: exceptionKeys.list(projectId, query),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<PageOrMissing> => {
      try {
        const response = await apiClient.get(EXCEPTION_ROUTES.list(projectId), {
          params: {
            status: query.status || undefined,
            severity: query.severity || undefined,
            kind: query.kind || undefined,
            subjectType: query.subjectType || undefined,
            subjectId: query.subjectId || undefined,
            limit: EXCEPTION_PAGE_SIZE,
            cursor: pageParam || undefined,
          },
        })
        return readExceptionPage(response.data)
      } catch (error) {
        if (isRouteMissing(error)) {
          return { state: 'not-on-server', items: [], withheld: null, nextCursor: null }
        }
        throw error
      }
    },
    getNextPageParam: (last) => (last.state === 'ok' ? last.nextCursor : null),
    enabled: Boolean(projectId) && enabled,
    retry: false,
    placeholderData: (previous) => previous,
  })

/**
 * The project's open counts: `{ total, bySeverity, withheld? }` (the shape
 * of the workspace dashboard's openExceptions, for one project). The counts
 * are the server's; nothing here adds them up.
 */
export const readExceptionsSummary = (body: unknown): ExceptionsSummary => {
  const data = (((body ?? {}) as { data?: unknown }).data ?? {}) as Record<string, unknown>
  const counts = (data.bySeverity ?? {}) as Record<string, unknown>
  const bySeverity: SeverityCounts = {}
  for (const severity of ['critical', 'warning', 'info'] as const) {
    if (typeof counts[severity] === 'number') bySeverity[severity] = counts[severity] as number
  }
  return {
    state: 'ok',
    total: typeof data.total === 'number' ? data.total : null,
    bySeverity,
    withheld: asWithheld(data.withheld),
  }
}

export const useExceptionsSummary = (
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery<ExceptionsSummary>({
    queryKey: exceptionKeys.summary(projectId),
    queryFn: async () => {
      try {
        const response = await apiClient.get(EXCEPTION_ROUTES.summary(projectId))
        return readExceptionsSummary(response.data)
      } catch (error) {
        if (isSummaryMissing(error)) {
          return { state: 'not-on-server', total: null, bySeverity: {}, withheld: null }
        }
        throw error
      }
    },
    enabled: Boolean(projectId) && enabled,
    retry: false,
  })

/** The bodies the API's validators take (routes/exceptions.js). */
export const EXCEPTION_REASON_MAX = 500
export const EXCEPTION_NOTE_MAX = 2000

export type ExceptionActionInput =
  | { action: 'review'; exceptionId: string; body: { note: string } }
  | { action: 'snooze'; exceptionId: string; body: { until: string; reason: string } }
  | { action: 'dismiss'; exceptionId: string; body: { reason: string } }
  | {
      action: 'associate-change-event'
      exceptionId: string
      body: { changeEventId: string }
    }

const invalidateExceptions = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: exceptionKeys.all(projectId) })
  qc.invalidateQueries({ queryKey: ['workspace-dashboard'] })
}

export const useExceptionAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ExceptionActionInput) =>
      apiClient
        .post(
          EXCEPTION_ROUTES.action(projectId, input.exceptionId, input.action),
          input.body
        )
        .then((response) => response.data?.data as ProjectException | undefined),
    onSuccess: () => {
      invalidateExceptions(qc, projectId)
      qc.invalidateQueries({ queryKey: ['change-events', projectId] })
    },
  })
}

/**
 * The server's prefill: `{ prefill, links, source? }` — the draft it
 * proposes (title, type, description, origin, activity, location, lines with
 * their quantity; amounts 0, left to the QS) and the typed link the raise
 * endpoint will set. The web never sends the link: the endpoint owns it.
 */
export type ChangeEventDraft = {
  title?: string
  description?: string | null
  type?: string
  origin?: string
  activityId?: string | null
  locationId?: string | null
  lines?: Array<Record<string, unknown>>
} & Record<string, unknown>

export type ChangeEventPrefill = {
  prefill: ChangeEventDraft
  links: Record<string, string>
  source: { type: string; id: string; path?: string | null } | null
}

/** Reads `data.prefill`; an answer without one is no prefill (the dialog says so). */
export const readChangeEventPrefill = (body: unknown): ChangeEventPrefill | null => {
  const data = (((body ?? {}) as { data?: unknown }).data ?? null) as Record<string, unknown> | null
  if (!data || !data.prefill || typeof data.prefill !== 'object') return null
  return {
    prefill: data.prefill as ChangeEventDraft,
    links: (data.links && typeof data.links === 'object' ? data.links : {}) as Record<string, string>,
    source: (data.source ?? null) as ChangeEventPrefill['source'],
  }
}

export const prefillKey = (projectId: string, source: ChangeEventSource | null) =>
  ['change-event-prefill', projectId, source?.type ?? '', source?.id ?? ''] as const

export const useChangeEventPrefill = (
  projectId: string,
  source: ChangeEventSource | null
) =>
  useQuery<ChangeEventPrefill | null>({
    queryKey: prefillKey(projectId, source),
    queryFn: () =>
      apiClient
        .get(EXCEPTION_ROUTES.changeEventPrefill(projectId, source!))
        .then((response) => readChangeEventPrefill(response.data)),
    enabled: Boolean(projectId && source),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

/** Money fields a prefill must never carry into the raise: the amount is left to the QS. */
export const AMOUNT_FIELDS = ['romAmount', 'unitCost', 'amount', 'quotedAmount'] as const

export const withoutAmounts = <T extends Record<string, unknown>>(record: T): T => {
  const copy: Record<string, unknown> = { ...record }
  for (const field of AMOUNT_FIELDS) delete copy[field]
  return copy as T
}

export type RaisedChangeEvent = { id: string; ref: string; status: string; path?: string | null }

/** What a person may set over the prefill when raising: the words, the type, the lines (no amount). */
export type RaiseChangeEventBody = {
  title: string
  type: string
  description: string | null
  lines: Array<Record<string, unknown>>
}

/**
 * The handoff (change intelligence §2): POST the source's raise endpoint,
 * which creates ONE draft change event with the typed link — for an
 * exception it also claims the exception, which then reads "in change".
 * An exception answers `{ exception, changeEvent }`, a record the event.
 */
export const useRaiseChangeEvent = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ source, body }: { source: ChangeEventSource; body: RaiseChangeEventBody }) =>
      apiClient
        .post(EXCEPTION_ROUTES.raiseChangeEvent(projectId, source), body)
        .then((response) => {
          const data = (response.data?.data ?? {}) as { changeEvent?: RaisedChangeEvent } & RaisedChangeEvent
          return data.changeEvent ?? data
        }),
    onSuccess: () => {
      invalidateExceptions(qc, projectId)
      qc.invalidateQueries({ queryKey: ['change-events', projectId] })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}
