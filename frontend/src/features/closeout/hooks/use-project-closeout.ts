import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** Project closeout / turnover (CLOSEOUT V1): `/projects/{id}/closeout`. */

const base = (projectId: string) => `/projects/${projectId}/closeout`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
const key = (projectId: string) => ['project-closeout', projectId] as const

export type DeliverableStatus =
  | 'outstanding'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'waived'
  | 'not_applicable'

export type MilestoneKey = 'substantial_completion' | 'handover' | 'final_completion'

export interface CloseoutCheck {
  key: string
  label: string
  module: string
  visible: boolean
  status: 'clear' | 'open' | 'waived' | 'restricted'
  open: number | null
  refs: string[]
  detail: string
  waiver: { reason: string; by: string; at: string } | null
}

export interface CloseoutGate {
  ready: boolean
  outstanding: string[]
  recorded: boolean
  requires: MilestoneKey[]
}

export interface CloseoutOverview {
  project: { id: string; name: string }
  status: 'in_progress' | 'substantially_complete' | 'handed_over' | 'final_complete'
  milestones: Array<{ key: MilestoneKey; label: string; at: string | null; by: string | null; note: string | null }>
  readiness: { checks: CloseoutCheck[]; clear: number; waived: number; open: number; restricted: number; note: string | null }
  deliverables: {
    total: number
    required: number
    requiredSettled: number
    settledPct: number
    overdue: number
    byStatus: Record<DeliverableStatus, number>
    byCategory: Array<{ category: string; label: string; total: number; settled: number }>
  }
  warranties: { total: number; active: number; expiring: number; expired: number; notStarted: number; expiringDays: number }
  gates: Record<MilestoneKey, CloseoutGate> | null
}

export interface CloseoutDeliverable {
  id: string
  ref: string
  category: string
  categoryLabel: string
  title: string
  description: string | null
  required: boolean
  status: DeliverableStatus
  settled: boolean
  responsibleCompanyId: string | null
  responsibleCompany: string | null
  responsibleUserId: string | null
  responsibleUser: string | null
  activityId: string | null
  activity: string | null
  locationId: string | null
  location: string | null
  dueDate: string | null
  overdue: boolean
  warrantyStart: string | null
  warrantyMonths: number | null
  warrantyEnd: string | null
  warranty: { state: 'active' | 'expiring' | 'expired' | 'not_started' | 'open_ended'; daysLeft: number | null } | null
  documents: Array<{ id: string; label: string }>
  submittedDocumentIds: string[]
  submittedAt: string | null
  submittedBy: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  reviewComment: string | null
  waivedReason: string | null
  updatedAt: string | null
}

export interface DeliverableList {
  items: CloseoutDeliverable[]
  categories: Record<string, string>
  statuses: DeliverableStatus[]
}

export interface DeliverableInput {
  title?: string
  category?: string
  description?: string | null
  required?: boolean
  responsibleCompanyId?: string | null
  dueDate?: string | null
  warrantyStart?: string | null
  warrantyMonths?: number | null
  warrantyEnd?: string | null
}

export const useCloseoutOverview = (projectId: string, enabled = true) =>
  useQuery<CloseoutOverview>({ queryKey: [...key(projectId), 'overview'], queryFn: () => data(apiClient.get(base(projectId))), enabled })

export const useCloseoutDeliverables = (projectId: string, filters: { status?: string; category?: string } = {}) =>
  useQuery<DeliverableList>({
    queryKey: [...key(projectId), 'deliverables', filters],
    queryFn: () => data(apiClient.get(`${base(projectId)}/deliverables`, { params: { status: filters.status || undefined, category: filters.category || undefined } })),
  })

export const useCloseoutWarranties = (projectId: string) =>
  useQuery<{ items: CloseoutDeliverable[]; summary: CloseoutOverview['warranties'] }>({
    queryKey: [...key(projectId), 'warranties'],
    queryFn: () => data(apiClient.get(`${base(projectId)}/warranties`)),
  })

/** Every closeout write refreshes the whole closeout picture: readiness, deliverables and warranties move together. */
const useCloseoutMutation = <TVars, TResult = unknown>(projectId: string, run: (vars: TVars) => Promise<TResult>) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useAddStandardDeliverables = (projectId: string) =>
  useCloseoutMutation<void, DeliverableList & { added: number }>(projectId, () => data(apiClient.post(`${base(projectId)}/deliverables/standard`)))

export const useCreateDeliverable = (projectId: string) =>
  useCloseoutMutation<DeliverableInput, CloseoutDeliverable>(projectId, (input) => data(apiClient.post(`${base(projectId)}/deliverables`, input)))

export const useUpdateDeliverable = (projectId: string) =>
  useCloseoutMutation<{ id: string; input: DeliverableInput }, CloseoutDeliverable>(projectId, ({ id, input }) => data(apiClient.patch(`${base(projectId)}/deliverables/${id}`, input)))

export const useDeleteDeliverable = (projectId: string) =>
  useCloseoutMutation<string>(projectId, (id) => data(apiClient.delete(`${base(projectId)}/deliverables/${id}`)))

export const useSubmitDeliverable = (projectId: string) =>
  useCloseoutMutation<{ id: string; note?: string }, CloseoutDeliverable>(projectId, ({ id, note }) => data(apiClient.post(`${base(projectId)}/deliverables/${id}/submit`, { note: note || null })))

export const useReviewDeliverable = (projectId: string) =>
  useCloseoutMutation<{ id: string; decision: 'accept' | 'reject'; comment?: string }, CloseoutDeliverable>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/deliverables/${id}/review`, body)))

export const useWaiveDeliverable = (projectId: string) =>
  useCloseoutMutation<{ id: string; status: 'waived' | 'not_applicable'; reason: string }, CloseoutDeliverable>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/deliverables/${id}/waive`, body)))

export const useReopenDeliverable = (projectId: string) =>
  useCloseoutMutation<{ id: string; reason: string }, CloseoutDeliverable>(projectId, ({ id, reason }) => data(apiClient.post(`${base(projectId)}/deliverables/${id}/reopen`, { reason })))

export const useWaiveCheck = (projectId: string) =>
  useCloseoutMutation<{ key: string; reason: string | null }, CloseoutOverview>(projectId, ({ key: checkKey, reason }) =>
    reason === null
      ? data(apiClient.delete(`${base(projectId)}/checks/${checkKey}/waiver`))
      : data(apiClient.post(`${base(projectId)}/checks/${checkKey}/waiver`, { reason }))
  )

export const useRecordMilestone = (projectId: string) =>
  useCloseoutMutation<{ milestone: MilestoneKey; date?: string | null; note?: string | null; override?: string | null }, CloseoutOverview>(projectId, ({ milestone, ...body }) =>
    data(apiClient.post(`${base(projectId)}/milestones/${milestone}`, body))
  )

export const useReopenMilestone = (projectId: string) =>
  useCloseoutMutation<string, CloseoutOverview>(projectId, (reason) => data(apiClient.post(`${base(projectId)}/milestones/reopen`, { reason })))
