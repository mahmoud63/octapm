import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { PermissionAction } from '@/lib/permissions'

export const PUNCH_STATUSES = [
  'draft',
  'open',
  'ready_for_review',
  'closed',
  'in_dispute',
  'void',
] as const
export type PunchStatus = (typeof PUNCH_STATUSES)[number]

export const PUNCH_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type PunchPriority = (typeof PUNCH_PRIORITIES)[number]

export type PunchAction =
  | 'open'
  | 'ready_for_review'
  | 'close'
  | 'reopen'
  | 'dispute'
  | 'resolve_dispute'
  | 'void'

export const STATUS_LABEL: Record<PunchStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  ready_for_review: 'Ready for review',
  closed: 'Closed',
  in_dispute: 'In dispute',
  void: 'Void',
}

export const ACTION_LABEL: Record<PunchAction, string> = {
  open: 'Open item',
  ready_for_review: 'Ready for review',
  close: 'Close',
  reopen: 'Reopen',
  dispute: 'Dispute',
  resolve_dispute: 'Resolve dispute',
  void: 'Void',
}

/** What can happen next from each status (mirrors the backend rules). */
export const ACTIONS_FOR_STATUS: Record<PunchStatus, PunchAction[]> = {
  draft: ['open', 'void'],
  open: ['ready_for_review', 'close', 'dispute', 'void'],
  ready_for_review: ['close', 'reopen', 'dispute', 'void'],
  closed: ['reopen'],
  in_dispute: ['resolve_dispute', 'void'],
  void: [],
}

export const REASON_REQUIRED: readonly PunchAction[] = [
  'reopen',
  'dispute',
  'void',
]

/** Permission each action needs — the same map the API enforces. */
export const ACTION_PERMISSION: Record<
  PunchAction,
  { action: PermissionAction; transition: string }
> = {
  open: { action: 'submit', transition: 'punch.open' },
  ready_for_review: { action: 'submit', transition: 'punch.ready_for_review' },
  close: { action: 'approve', transition: 'punch.close' },
  reopen: { action: 'submit', transition: 'punch.reopen' },
  dispute: { action: 'submit', transition: 'punch.dispute' },
  resolve_dispute: { action: 'submit', transition: 'punch.reopen' },
  void: { action: 'approve', transition: 'punch.void' },
}

export interface PunchPerson {
  id: string
  name: string
  email?: string | null
}

export interface PunchEvent {
  id: string
  action: string
  fromStatus: string | null
  toStatus: string | null
  reason: string | null
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface PunchItem {
  id: string
  projectId: string
  number: number
  ref: string
  title: string
  description: string | null
  status: PunchStatus
  priority: PunchPriority
  trade: string | null
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  locationId: string | null
  location: {
    id: string
    name: string
    code: string | null
    path: string
  } | null
  locationText: string | null
  sheetId: string | null
  sheet: { id: string; number: string; title: string } | null
  assigneeCompanyId: string | null
  assigneeCompany: { id: string; name: string } | null
  assigneeUserId: string | null
  assigneeUser: PunchPerson | null
  managerUserId: string | null
  managerUser: PunchPerson | null
  finalApproverUserId: string | null
  finalApproverUser: PunchPerson | null
  ballInCourtUserId: string | null
  ballInCourtUser: { id: string; name: string } | null
  dueDate: string | null
  isOverdue: boolean
  daysOverdue: number
  openedAt: string | null
  readyAt: string | null
  closedAt: string | null
  closedBy: string | null
  reopenCount: number
  disputeReason: string | null
  distributedAt: string | null
  legacyDefectId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  path: string | null
  attachments?: Array<Record<string, unknown>>
  activityLinks?: Array<Record<string, unknown>>
  events?: PunchEvent[]
}

export interface PunchSummary {
  total: number
  open: number
  overdue: number
  byStatus: Partial<Record<PunchStatus, number>>
  byCompany: Array<{
    company: string
    total: number
    open: number
    overdue: number
  }>
  byTrade: Array<{ trade: string; count: number }>
}

export interface PunchListResponse {
  items: PunchItem[]
  summary: PunchSummary
}

export interface PunchFilters {
  /** Status, comma list, or `all`; empty hides void items only. */
  status?: string
  assigneeCompanyId?: string | null
  assigneeUserId?: string | null
  managerUserId?: string | null
  finalApproverUserId?: string | null
  /** A user id or `me`. */
  ballInCourtUserId?: string | null
  locationId?: string | null
  sheetId?: string | null
  trade?: string | null
  priority?: PunchPriority | '' | null
  overdue?: boolean
  search?: string
  limit?: number
}

export type PunchGroupBy = 'company' | 'location' | 'none'

export interface PunchItemInput {
  title?: string
  description?: string | null
  priority?: PunchPriority
  trade?: string | null
  locationText?: string | null
  locationId?: string | null
  sheetId?: string | null
  activityId?: string | null
  assigneeCompanyId?: string | null
  assigneeUserId?: string | null
  managerUserId?: string | null
  finalApproverUserId?: string | null
  dueDate?: string | null
  status?: 'draft' | 'open'
}

export interface PunchDistributeResult {
  items: number
  recipients: Array<{
    userId: string
    email: string
    delivered: boolean
    error: string | null
  }>
  distributedAt: string
}

export const punchKeys = {
  all: (projectId: string) => ['punch', projectId] as const,
  list: (projectId: string, filters: PunchFilters) =>
    ['punch', projectId, filters] as const,
  item: (projectId: string, itemId: string) =>
    ['punch-item', projectId, itemId] as const,
}

const toParams = (filters: PunchFilters) => ({
  status: filters.status || undefined,
  assigneeCompanyId: filters.assigneeCompanyId || undefined,
  assigneeUserId: filters.assigneeUserId || undefined,
  managerUserId: filters.managerUserId || undefined,
  finalApproverUserId: filters.finalApproverUserId || undefined,
  ballInCourtUserId: filters.ballInCourtUserId || undefined,
  locationId: filters.locationId || undefined,
  sheetId: filters.sheetId || undefined,
  trade: filters.trade || undefined,
  priority: filters.priority || undefined,
  overdue: filters.overdue ? 'true' : undefined,
  search: filters.search?.trim() || undefined,
  limit: filters.limit || undefined,
})

export const usePunchItems = (
  projectId: string,
  filters: PunchFilters = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<PunchListResponse>({
    queryKey: punchKeys.list(projectId, filters),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: PunchListResponse }>(
        `/projects/${projectId}/punch`,
        { params: toParams(filters) }
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId),
  })

export const usePunchItem = (projectId: string, itemId: string | null) =>
  useQuery<PunchItem>({
    queryKey: punchKeys.item(projectId, itemId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: PunchItem }>(
        `/projects/${projectId}/punch/${itemId}`
      )
      return data.data
    },
    enabled: Boolean(projectId && itemId),
  })

const invalidatePunch = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  queryClient.invalidateQueries({ queryKey: ['punch', projectId] })
  queryClient.invalidateQueries({ queryKey: ['punch-item', projectId] })
  queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
  queryClient.invalidateQueries({ queryKey: ['quality-dashboard', projectId] })
  queryClient.invalidateQueries({ queryKey: ['record-pins', projectId] })
  queryClient.invalidateQueries({ queryKey: ['sheet-pins', projectId] })
}

export const useCreatePunchItem = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PunchItemInput) => {
      const { data } = await apiClient.post<{ data: PunchItem }>(
        `/projects/${projectId}/punch`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidatePunch(queryClient, projectId),
  })
}

export const useBulkCreatePunchItems = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      items: PunchItemInput[]
      defaults?: PunchItemInput
    }) => {
      const { data } = await apiClient.post<{
        data: { items: PunchItem[]; created: number }
      }>(`/projects/${projectId}/punch/bulk`, input)
      return data.data
    },
    onSuccess: () => invalidatePunch(queryClient, projectId),
  })
}

export const useUpdatePunchItem = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      itemId,
      payload,
    }: {
      itemId: string
      payload: PunchItemInput
    }) => {
      const { data } = await apiClient.patch<{ data: PunchItem }>(
        `/projects/${projectId}/punch/${itemId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidatePunch(queryClient, projectId),
  })
}

export const useTransitionPunchItem = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      itemId,
      action,
      reason,
    }: {
      itemId: string
      action: PunchAction
      reason?: string | null
    }) => {
      const { data } = await apiClient.post<{ data: PunchItem }>(
        `/projects/${projectId}/punch/${itemId}/transition`,
        { action, reason: reason || undefined }
      )
      return data.data
    },
    onSuccess: () => invalidatePunch(queryClient, projectId),
  })
}

export const useDeletePunchItem = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { data } = await apiClient.delete<{
        data: { deleted: boolean; id: string }
      }>(`/projects/${projectId}/punch/${itemId}`)
      return data.data
    },
    onSuccess: () => invalidatePunch(queryClient, projectId),
  })
}

export const useDistributePunchItems = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      itemIds?: string[]
      companyIds?: string[]
      userIds?: string[]
      message?: string | null
    }) => {
      const { data } = await apiClient.post<{ data: PunchDistributeResult }>(
        `/projects/${projectId}/punch/distribute`,
        input
      )
      return data.data
    },
    onSuccess: () => invalidatePunch(queryClient, projectId),
  })
}

/** Downloads the punch list as PDF or CSV with the current filters. */
export const downloadPunchExport = async (
  projectId: string,
  format: 'pdf' | 'csv',
  options: PunchFilters & { groupBy?: PunchGroupBy; includePhotos?: boolean }
) => {
  const response = await apiClient.get(
    `/projects/${projectId}/punch/export.${format}`,
    {
      params: {
        ...toParams(options),
        groupBy: format === 'pdf' ? options.groupBy || undefined : undefined,
        includePhotos:
          format === 'pdf' && options.includePhotos ? 'true' : undefined,
      },
      responseType: 'blob',
      timeout: 120_000,
    }
  )
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const fileName = match?.[1] ?? `punch-list.${format}`
  const blob = new Blob([response.data], {
    type: format === 'pdf' ? 'application/pdf' : 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return fileName
}

export const formatPunchDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'

export const isPunchLocked = (status: PunchStatus) =>
  status === 'closed' || status === 'void'
