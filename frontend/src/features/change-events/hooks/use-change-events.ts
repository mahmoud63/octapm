import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Change events and RFQs (OCTA-COM-CE-038): potential changes with scope
 * lines and a rough order of magnitude, RFQs to vendors answered through a
 * public link, quote acceptance and conversion into change orders.
 */

export type ChangeEventStatus =
  | 'open'
  | 'pricing'
  | 'priced'
  | 'converted'
  | 'closed'
  | 'void'
export type ChangeEventType =
  | 'owner_change'
  | 'design_change'
  | 'site_condition'
  | 'error_omission'
  | 'allowance'
  | 'value_engineering'
  | 'other'
export type ChangeEventOrigin =
  | 'manual'
  | 'rfi'
  | 'submittal'
  | 'daily_log'
  | 'observation'
  | 'meeting'
  | 'exception'
  | 'other'
export type RfqStatus =
  | 'sent'
  | 'viewed'
  | 'quoted'
  | 'declined'
  | 'accepted'
  | 'rejected'
  | 'cancelled'

export const CHANGE_EVENT_TYPE_LABEL: Record<ChangeEventType, string> = {
  owner_change: 'Owner change',
  design_change: 'Design change',
  site_condition: 'Site condition',
  error_omission: 'Error / omission',
  allowance: 'Allowance',
  value_engineering: 'Value engineering',
  other: 'Other',
}

/**
 * Where a change event came from, as the API stores it (change-event.service
 * ORIGINS). 'exception' is set only by the PC-7b handoff — a person raising
 * the event from a project exception — so it is named, never left unknown.
 */
export const CHANGE_EVENT_ORIGIN_LABEL: Record<ChangeEventOrigin, string> = {
  manual: 'Manual',
  rfi: 'RFI',
  submittal: 'Submittal',
  daily_log: 'Daily log',
  observation: 'Observation',
  meeting: 'Meeting',
  exception: 'Project exception',
  other: 'Other',
}

/** The origin's label; a value this build does not know is shown as the server sent it, readable. */
export const changeEventOriginLabel = (origin: string) =>
  CHANGE_EVENT_ORIGIN_LABEL[origin as ChangeEventOrigin] ?? origin.replace(/_/g, ' ')

export const CHANGE_EVENT_STATUS_LABEL: Record<ChangeEventStatus, string> = {
  open: 'Open',
  pricing: 'Pricing',
  priced: 'Priced',
  converted: 'Converted',
  closed: 'Closed',
  void: 'Void',
}

/**
 * A line. The activity, cost code, quantity, unit and unit cost are left out
 * for a member without BOQ read when the line took them from a BOQ-derived
 * project exception — the event's `sourceWithheld.keys` then names each one
 * as `lines[<id>].<field>`, with the reason (PC-7b; utils/boq-figures).
 */
export interface ChangeEventLine {
  id: string
  description: string
  costCodeId?: string | null
  costCode?: { id: string; code: string; name: string } | null
  budgetLineId: string | null
  activityId?: string | null
  activity?: { id: string; name: string; code: string | null } | null
  commitmentId: string | null
  commitment: {
    id: string
    ref: string
    title: string
    vendorName: string | null
  } | null
  quantity?: number
  unit?: string | null
  unitCost?: number
  romAmount: number
  quotedAmount: number | null
  quotedRfqId: string | null
  amount: number
  notes: string | null
  sortOrder: number
}

export interface ChangeEventLinePayload {
  id?: string | null
  description: string
  costCodeId?: string | null
  activityId?: string | null
  commitmentId?: string | null
  quantity?: number
  unit?: string | null
  unitCost?: number | null
  romAmount?: number | null
  notes?: string | null
}

export interface Rfq {
  id: string
  changeEventId: string
  number: number
  ref: string
  commitmentId: string | null
  commitment: { id: string; ref: string; title: string } | null
  vendorCompanyId: string | null
  companyName: string
  contactName: string | null
  contactEmail?: string | null
  status: RfqStatus
  dueDate: string | null
  expiresAt: string | null
  instructions: string | null
  lineIds: string[]
  sentAt: string | null
  viewedAt: string | null
  quotedAt: string | null
  quoteTotal: number | null
  quoteLines: Array<{
    lineId: string
    amount: number | null
    note: string | null
  }>
  quoteNotes: string | null
  quoteValidUntil: string | null
  quoteLeadTimeDays: number | null
  quotedBy: string | null
  declinedReason: string | null
  acceptedAt: string | null
  rejectedAt: string | null
  rejectedReason: string | null
  commitmentChangeOrderId: string | null
  commitmentChangeOrder: { id: string; ref: string; status: string } | null
  remindersSent: number
  portalUrl?: string | null
}

export interface ChangeEvent {
  id: string
  projectId: string
  number: number
  ref: string
  title: string
  description: string | null
  type: ChangeEventType
  origin: ChangeEventOrigin
  sourceRecordType: string | null
  sourceRecordId: string | null
  sourcePath: string | null
  status: ChangeEventStatus
  /** Left out when withheld (`sourceWithheld.keys` has 'activityId'). */
  activityId?: string | null
  activity?: { id: string; name: string; code: string | null } | null
  locationId: string | null
  location: { id: string; name: string } | null
  romAmount: number
  scheduleImpactDays: number
  ownerChange: boolean
  totals: { rom: number; quoted: number | null; estimate: number }
  changeOrderId: string | null
  changeOrder: {
    id: string
    ref: string
    status: string
    value: number | null
    path: string
  } | null
  convertedAt: string | null
  closedAt: string | null
  voidReason: string | null
  notes: string | null
  lineCount?: number | null
  rfqCounts: { total: number; quoted: number; accepted: number; open: number }
  lines?: ChangeEventLine[]
  rfqs?: Rfq[]
  path: string
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
  /**
   * PC-7b: present when the event was raised from a BOQ-derived project
   * exception and this member may not read the BOQ. `keys` names what the
   * server left out — the source link ('sourceLinks.project_exception',
   * 'sourceRecordType', 'sourceRecordId', 'sourcePath'), the event's
   * 'activityId', and per line `lines[<lineId>].<field>` — with the reason.
   * A withheld field is shown as "—" with the reason and never sent back.
   */
  sourceWithheld?: { keys: string[]; reason: string }
}

/** Whether the server withheld this field of the event (or of one line) from this member. */
export const isChangeEventFieldWithheld = (
  event: Pick<ChangeEvent, 'sourceWithheld'> | null | undefined,
  field: string,
  lineId?: string | null
) =>
  Boolean(
    event?.sourceWithheld?.keys.includes(
      lineId ? `lines[${lineId}].${field}` : field
    )
  )

export interface ChangeEventPayload {
  title?: string
  description?: string | null
  type?: ChangeEventType
  origin?: ChangeEventOrigin
  sourceRecordType?: string | null
  sourceRecordId?: string | null
  activityId?: string | null
  locationId?: string | null
  romAmount?: number | null
  scheduleImpactDays?: number
  ownerChange?: boolean
  notes?: string | null
  lines?: ChangeEventLinePayload[]
}

export interface ChangeEventSummary {
  count: number
  byStatus: Record<ChangeEventStatus, number>
  romTotal: number
  quotedTotal: number
  convertedValue: number
  openRfqs: number
  quotesWaiting: number
}

const base = (projectId: string) => `/projects/${projectId}/change-events`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const changeEventKeys = {
  all: (projectId: string) => ['change-events', projectId] as const,
  list: (projectId: string, query: Record<string, string | undefined>) =>
    ['change-events', projectId, 'list', query] as const,
  one: (projectId: string, id: string) =>
    ['change-events', projectId, 'one', id] as const,
}

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: changeEventKeys.all(projectId) })
  qc.invalidateQueries({ queryKey: ['change-orders', projectId] })
  qc.invalidateQueries({ queryKey: ['commitments', projectId] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useChangeEvents = (
  projectId: string,
  query: { status?: string; type?: string; q?: string } = {}
) =>
  useQuery<{ items: ChangeEvent[]; summary: ChangeEventSummary }>({
    queryKey: changeEventKeys.list(projectId, query),
    queryFn: () =>
      data(
        apiClient.get(base(projectId), {
          params: {
            status: query.status || undefined,
            type: query.type || undefined,
            q: query.q?.trim() || undefined,
          },
        })
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useChangeEvent = (projectId: string, id: string | null) =>
  useQuery<ChangeEvent>({
    queryKey: changeEventKeys.one(projectId, id ?? ''),
    queryFn: () => data(apiClient.get(`${base(projectId)}/${id}`)),
    enabled: Boolean(projectId && id),
  })

export const useCreateChangeEvent = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ChangeEventPayload) =>
      data<ChangeEvent>(apiClient.post(base(projectId), payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateChangeEvent = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: ChangeEventPayload & { id: string }) =>
      data<ChangeEvent>(apiClient.patch(`${base(projectId)}/${id}`, payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteChangeEvent = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ deleted: boolean }>(apiClient.delete(`${base(projectId)}/${id}`)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useSendRfqs = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string
      recipients: Array<{
        commitmentId?: string | null
        companyName?: string | null
        contactName?: string | null
        contactEmail?: string | null
      }>
      dueDate?: string | null
      instructions?: string | null
      lineIds?: string[]
    }) =>
      data<{ sent: number; rfqs: Rfq[]; changeEvent: ChangeEvent }>(
        apiClient.post(`${base(projectId)}/${id}/rfqs`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useRfqAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfqId,
      action,
      body,
    }: {
      rfqId: string
      action: 'remind' | 'cancel' | 'accept' | 'reject'
      body?: Record<string, unknown>
    }) =>
      data<Rfq | { changeEvent: ChangeEvent; commitmentChangeOrder: unknown }>(
        apiClient.post(`${base(projectId)}/rfqs/${rfqId}/${action}`, body ?? {})
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useChangeEventAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string
      action: 'convert' | 'close' | 'void'
      body?: Record<string, unknown>
    }) =>
      data<
        | ChangeEvent
        | {
            changeEvent: ChangeEvent
            changeOrder: { id: string; ref: string; path: string }
            commitmentChangeOrders: Array<{ id: string; ref: string | null }>
          }
      >(apiClient.post(`${base(projectId)}/${id}/${action}`, body ?? {})),
    onSuccess: () => invalidate(qc, projectId),
  })
}
