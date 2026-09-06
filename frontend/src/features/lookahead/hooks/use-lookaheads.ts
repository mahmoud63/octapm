import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Lookaheads (OCTA-SCH-LOOKAHEAD-041): short-interval plans seeded from the
 * master schedule, with constraints and weekly percent-plan-complete.
 */

export type LookaheadStatus = 'draft' | 'published' | 'archived'
export type LookaheadItemStatus =
  | 'planned'
  | 'in_progress'
  | 'done'
  | 'not_done'
export type LookaheadConstraintStatus = 'none' | 'open' | 'cleared'
export type LookaheadVarianceReason =
  | 'design'
  | 'material'
  | 'labour'
  | 'equipment'
  | 'weather'
  | 'prerequisite'
  | 'permit'
  | 'space'
  | 'other'
export type LookaheadItemSource = 'schedule' | 'added' | 'carried'

export const LOOKAHEAD_STATUS_LABEL: Record<LookaheadStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

export const ITEM_STATUS_LABEL: Record<LookaheadItemStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  not_done: 'Not done',
}

export const VARIANCE_REASON_LABEL: Record<LookaheadVarianceReason, string> = {
  design: 'Design / information',
  material: 'Material',
  labour: 'Labour',
  equipment: 'Equipment',
  weather: 'Weather',
  prerequisite: 'Prerequisite work',
  permit: 'Permit / approval',
  space: 'Space / access',
  other: 'Other',
}

export const WEEK_OPTIONS = [2, 3, 4, 5, 6] as const

export interface LookaheadFilter {
  wbsPrefixes: string[]
  categories: string[]
  activityIds: string[]
  onlyCritical: boolean
}

export interface LookaheadItem {
  id: string
  lookaheadId: string
  activityId: string | null
  activity: {
    id: string
    name: string
    code: string | null
    wbsCode: string | null
    isCritical: boolean
    isMilestone: boolean
    totalFloat: number | null
  } | null
  source: LookaheadItemSource
  name: string
  wbsCode: string | null
  plannedStart: string
  plannedFinish: string
  scheduleStart: string | null
  scheduleFinish: string | null
  datesEdited: boolean
  driftDays: number | null
  crewId: string | null
  crew: { id: string; name: string; companyId: string | null } | null
  companyId: string | null
  assigneeUserId: string | null
  locationId: string | null
  location: { id: string; name: string; code: string | null } | null
  quantity: number | null
  unit: string | null
  status: LookaheadItemStatus
  pctComplete: number
  varianceReason: LookaheadVarianceReason | null
  constraint: string | null
  constraintStatus: LookaheadConstraintStatus
  constraintOwnerUserId: string | null
  constraintDueDate: string | null
  constraintClearedAt: string | null
  constraintOverdue: boolean
  behind: boolean
  notes: string | null
  sortOrder: number
  carriedFromItemId: string | null
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface LookaheadWeekPpc {
  week: number
  start: string
  end: string
  closed: boolean
  committed: number
  completed: number
  notDone: number
  ppc: number | null
}

export interface LookaheadSummary {
  items: number
  byStatus: Record<LookaheadItemStatus, number>
  openConstraints: number
  overdueConstraints: number
  behind: number
  ppc: {
    weeks: LookaheadWeekPpc[]
    closedWeeks: number
    committed: number
    completed: number
    ppc: number | null
    varianceReasons: Partial<Record<LookaheadVarianceReason, number>>
  }
}

export interface LookaheadGridDay {
  date: string
  dow: number
  label: string
  working: boolean
  isToday: boolean
}

export interface LookaheadGridWeek {
  index: number
  start: string
  end: string
  label: string
  closed: boolean
  current: boolean
  days: LookaheadGridDay[]
}

export interface Lookahead {
  id: string
  projectId: string
  number: number
  ref: string
  title: string
  startDate: string
  endDate: string
  weeks: number
  weekStartDay: number
  status: LookaheadStatus
  filter: LookaheadFilter
  notes: string | null
  publishedBy: string | null
  publishedAt: string | null
  archivedBy: string | null
  archivedAt: string | null
  refreshedAt: string | null
  rolledFromId: string | null
  current: boolean
  summary: LookaheadSummary
  grid?: LookaheadGridWeek[]
  items?: LookaheadItem[]
  path: string
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface LookaheadPayload {
  startDate?: string
  weeks?: number
  weekStartDay?: number
  title?: string | null
  notes?: string | null
  filter?: Partial<LookaheadFilter>
  seed?: boolean
}

export interface LookaheadItemPayload {
  name?: string | null
  activityId?: string | null
  wbsCode?: string | null
  plannedStart?: string | null
  plannedFinish?: string | null
  crewId?: string | null
  companyId?: string | null
  assigneeUserId?: string | null
  locationId?: string | null
  quantity?: number | null
  unit?: string | null
  status?: LookaheadItemStatus
  pctComplete?: number | null
  varianceReason?: LookaheadVarianceReason | null
  constraint?: string | null
  constraintStatus?: LookaheadConstraintStatus
  constraintOwnerUserId?: string | null
  constraintDueDate?: string | null
  notes?: string | null
  sortOrder?: number
}

export interface LookaheadConstraintRow extends LookaheadItem {
  lookahead: {
    id: string
    ref: string
    title: string
    status: LookaheadStatus
  } | null
}

const base = (projectId: string) => `/projects/${projectId}/lookaheads`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const lookaheadKeys = {
  all: (projectId: string) => ['lookaheads', projectId] as const,
  list: (projectId: string, status?: string) =>
    ['lookaheads', projectId, 'list', status ?? 'all'] as const,
  one: (projectId: string, id: string) =>
    ['lookaheads', projectId, 'one', id] as const,
  constraints: (projectId: string) =>
    ['lookaheads', projectId, 'constraints'] as const,
}

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: lookaheadKeys.all(projectId) })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useLookaheads = (projectId: string, status?: LookaheadStatus) =>
  useQuery<{
    items: Lookahead[]
    summary: {
      count: number
      byStatus: Record<LookaheadStatus, number>
      currentId: string | null
      openConstraints: number
    }
  }>({
    queryKey: lookaheadKeys.list(projectId, status),
    queryFn: () =>
      data(
        apiClient.get(base(projectId), {
          params: status ? { status } : undefined,
        })
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useLookahead = (projectId: string, id: string | null) =>
  useQuery<Lookahead>({
    queryKey: lookaheadKeys.one(projectId, id ?? ''),
    queryFn: () => data(apiClient.get(`${base(projectId)}/${id}`)),
    enabled: Boolean(projectId && id),
  })

export const useLookaheadConstraints = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{
    items: LookaheadConstraintRow[]
    summary: { open: number; overdue: number; dueThisWeek: number }
  }>({
    queryKey: lookaheadKeys.constraints(projectId),
    queryFn: () => data(apiClient.get(`${base(projectId)}/constraints`)),
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })

export const useCreateLookahead = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: LookaheadPayload) =>
      data<Lookahead>(apiClient.post(base(projectId), payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateLookahead = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: LookaheadPayload & { id: string }) =>
      data<Lookahead>(apiClient.patch(`${base(projectId)}/${id}`, payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteLookahead = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ deleted: boolean }>(apiClient.delete(`${base(projectId)}/${id}`)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useLookaheadAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string
      action: 'refresh' | 'publish' | 'archive' | 'roll-forward'
      body?: Record<string, unknown>
    }) =>
      data<
        Lookahead & {
          added?: number
          updated?: number
          completed?: number
          lookahead?: Lookahead
        }
      >(apiClient.post(`${base(projectId)}/${id}/${action}`, body ?? {})),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useAddLookaheadItem = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      lookaheadId,
      ...payload
    }: LookaheadItemPayload & { lookaheadId: string }) =>
      data<LookaheadItem>(
        apiClient.post(`${base(projectId)}/${lookaheadId}/items`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateLookaheadItem = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      lookaheadId,
      itemId,
      ...payload
    }: LookaheadItemPayload & { lookaheadId: string; itemId: string }) =>
      data<LookaheadItem>(
        apiClient.patch(
          `${base(projectId)}/${lookaheadId}/items/${itemId}`,
          payload
        )
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useSetLookaheadItemStatus = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      lookaheadId,
      itemId,
      ...payload
    }: {
      lookaheadId: string
      itemId: string
      status: LookaheadItemStatus
      varianceReason?: LookaheadVarianceReason | null
      pctComplete?: number | null
      notes?: string | null
    }) =>
      data<LookaheadItem>(
        apiClient.post(
          `${base(projectId)}/${lookaheadId}/items/${itemId}/status`,
          payload
        )
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useRemoveLookaheadItem = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      lookaheadId,
      itemId,
    }: {
      lookaheadId: string
      itemId: string
    }) =>
      data<{ removed: boolean }>(
        apiClient.delete(`${base(projectId)}/${lookaheadId}/items/${itemId}`)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

/** Downloads a file the API answers with as an attachment. */
export const downloadFile = async (url: string, fallbackName: string) => {
  const response = await apiClient.get(url, { responseType: 'blob' })
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = disposition.match(/filename="([^"]+)"/)
  const name = match?.[1] ?? fallbackName
  const blob = new Blob([response.data], {
    type: String(
      response.headers?.['content-type'] ?? 'application/octet-stream'
    ),
  })
  const href = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.setAttribute('download', name)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(href)
  return name
}
