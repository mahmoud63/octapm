import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
 * Every address the screens use is here, so a route the API names
 * differently is changed in one place.
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

export type ProjectException = {
  id: string
  kind: string
  severity: ExceptionSeverity
  status: ExceptionStatus
  subject: ExceptionSubject
  secondarySubject?: ExceptionSubject | null
  /** Structure the subject sits in (WBS, location, cost code), as the server labels it. */
  group?: Record<string, unknown> | null
  measured: ExceptionFigure
  limit: ExceptionFigure
  detectedAt: string | null
  lastSeenAt: string | null
  review?: {
    reviewedAt: string | null
    reviewedBy: string | null
    note: string | null
  } | null
  changeEvent?: { id: string; ref: string; status: string } | null
  /** Optional detail a server may add: when a snooze ends, why a row was dismissed. */
  snoozedUntil?: string | null
  dismissal?: { reason: string | null; at?: string | null; by?: string | null } | null
  actions: ExceptionActions
}

/** The server's marker for exceptions it withheld from this caller: a reason, never a count. */
export type ExceptionsWithheld = { reason: string }

/**
 * A list as the server answered it. `not-on-server` is a 404 from the
 * exceptions route itself (a server without PC-7b): said as that, never as
 * an empty list.
 */
export type ExceptionList =
  | { state: 'ok'; items: ProjectException[]; withheld: ExceptionsWithheld | null }
  | { state: 'not-on-server'; items: []; withheld: null }

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
  /** Exceptions touching one record (subject, secondary subject, or the record's allocations). */
  recordType?: string
  recordId?: string
}

export const EXCEPTION_ROUTES = {
  list: (projectId: string) => `/projects/${projectId}/exceptions`,
  summary: (projectId: string) => `/projects/${projectId}/exceptions/summary`,
  action: (
    projectId: string,
    exceptionId: string,
    action: 'review' | 'snooze' | 'dismiss' | 'associate-change-event'
  ) => `/projects/${projectId}/exceptions/${exceptionId}/${action}`,
  /** The server's change-event prefill for a source record (an exception, an RFI, a daily log …). */
  changeEventPrefill: (projectId: string) =>
    `/projects/${projectId}/change-events/prefill`,
}

export const exceptionKeys = {
  all: (projectId: string) => ['project-exceptions', projectId] as const,
  list: (projectId: string, query: ExceptionListQuery) =>
    ['project-exceptions', projectId, 'list', query] as const,
  summary: (projectId: string) =>
    ['project-exceptions', projectId, 'summary'] as const,
}

const isNotFound = (error: unknown) =>
  error instanceof AxiosError && error.response?.status === 404

const asWithheld = (value: unknown): ExceptionsWithheld | null => {
  if (!value || typeof value !== 'object') return null
  const reason = (value as { reason?: unknown }).reason
  return { reason: typeof reason === 'string' && reason ? reason : 'Withheld' }
}

/**
 * The list envelope: `{ success, data: [...], withheld? }`, or the same
 * pair nested in `data` (`{ data: { data | items, withheld? } }`). Both are
 * read; nothing else is inferred.
 */
export const readExceptionList = (body: unknown): ExceptionList => {
  const outer = (body ?? {}) as Record<string, unknown>
  const inner = outer.data as unknown
  if (Array.isArray(inner)) {
    return {
      state: 'ok',
      items: inner as ProjectException[],
      withheld: asWithheld(outer.withheld),
    }
  }
  const nested = (inner ?? {}) as Record<string, unknown>
  const items = Array.isArray(nested.data)
    ? nested.data
    : Array.isArray(nested.items)
      ? nested.items
      : []
  return {
    state: 'ok',
    items: items as ProjectException[],
    withheld: asWithheld(nested.withheld ?? outer.withheld),
  }
}

/** `{ open: { total, bySeverity }, withheld? }` or the counts at the top level. */
export const readExceptionsSummary = (body: unknown): ExceptionsSummary => {
  const outer = (body ?? {}) as Record<string, unknown>
  const data = (outer.data ?? {}) as Record<string, unknown>
  const open = (data.open ?? data) as Record<string, unknown>
  const counts = (open.bySeverity ?? {}) as Record<string, unknown>
  const bySeverity: SeverityCounts = {}
  for (const severity of ['critical', 'warning', 'info'] as const) {
    if (typeof counts[severity] === 'number') bySeverity[severity] = counts[severity] as number
  }
  return {
    state: 'ok',
    total: typeof open.total === 'number' ? open.total : null,
    bySeverity,
    withheld: asWithheld(data.withheld ?? open.withheld ?? outer.withheld),
  }
}

export const useProjectExceptions = (
  projectId: string,
  query: ExceptionListQuery = {},
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery<ExceptionList>({
    queryKey: exceptionKeys.list(projectId, query),
    queryFn: async () => {
      try {
        const response = await apiClient.get(EXCEPTION_ROUTES.list(projectId), {
          params: {
            status: query.status || undefined,
            severity: query.severity || undefined,
            kind: query.kind || undefined,
            recordType: query.recordType || undefined,
            recordId: query.recordId || undefined,
          },
        })
        return readExceptionList(response.data)
      } catch (error) {
        if (isNotFound(error)) return { state: 'not-on-server', items: [], withheld: null }
        throw error
      }
    },
    enabled: Boolean(projectId) && enabled,
    retry: false,
    placeholderData: (previous) => previous,
  })

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
        if (isNotFound(error)) {
          return { state: 'not-on-server', total: null, bySeverity: {}, withheld: null }
        }
        throw error
      }
    },
    enabled: Boolean(projectId) && enabled,
    retry: false,
  })

export type ExceptionActionInput =
  | { action: 'review'; exceptionId: string; body: { note: string | null } }
  | { action: 'snooze'; exceptionId: string; body: { until: string; note: string | null } }
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

/** Where a change event can be raised from, and the typed link it carries (change intelligence §5). */
export type ChangeEventSourceType =
  | 'exception'
  | 'rfi'
  | 'daily_log'
  | 'ncr'
  | 'punch_item'
  | 'drawing_revision'
  | 'submittal'
  | 'meeting_action_item'

export type ChangeEventSource = { type: ChangeEventSourceType; id: string }

/**
 * The server's prefill: the create payload it proposes (origin, activity,
 * location, the typed source link, lines with their quantity) and how it
 * names the source. The amount is never in it — pricing is the QS's.
 */
export type ChangeEventPrefill = {
  payload: Record<string, unknown> & {
    title?: string
    description?: string | null
    type?: string
    origin?: string
    lines?: Array<Record<string, unknown>>
  }
  source: { type: string; id: string; label: string | null } | null
  notes: string[]
}

export const readChangeEventPrefill = (body: unknown): ChangeEventPrefill => {
  const data = ((body ?? {}) as { data?: unknown }).data as Record<string, unknown> | undefined
  const payload = (data?.payload ?? data ?? {}) as ChangeEventPrefill['payload']
  const source = (data?.source ?? null) as ChangeEventPrefill['source']
  const notes = Array.isArray(data?.notes)
    ? (data!.notes as unknown[]).filter((note): note is string => typeof note === 'string')
    : []
  return { payload, source, notes }
}

export const prefillKey = (projectId: string, source: ChangeEventSource | null) =>
  ['change-event-prefill', projectId, source?.type ?? '', source?.id ?? ''] as const

export const useChangeEventPrefill = (
  projectId: string,
  source: ChangeEventSource | null
) =>
  useQuery<ChangeEventPrefill>({
    queryKey: prefillKey(projectId, source),
    queryFn: () =>
      apiClient
        .get(EXCEPTION_ROUTES.changeEventPrefill(projectId), {
          params: { sourceType: source!.type, sourceId: source!.id },
        })
        .then((response) => readChangeEventPrefill(response.data)),
    enabled: Boolean(projectId && source),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

/** Money fields a prefill must never carry into the create: the amount is left to the QS. */
export const AMOUNT_FIELDS = ['romAmount', 'unitCost', 'amount', 'quotedAmount'] as const

export const withoutAmounts = <T extends Record<string, unknown>>(record: T): T => {
  const copy: Record<string, unknown> = { ...record }
  for (const field of AMOUNT_FIELDS) delete copy[field]
  return copy as T
}

export const useCreateChangeEventFromPrefill = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiClient
        .post(`/projects/${projectId}/change-events`, payload)
        .then(
          (response) =>
            response.data.data as { id: string; ref: string; status: string; path?: string }
        ),
    onSuccess: () => {
      invalidateExceptions(qc, projectId)
      qc.invalidateQueries({ queryKey: ['change-events', projectId] })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}
