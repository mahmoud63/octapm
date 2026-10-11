import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { useProjectEffectiveRole } from '@/lib/permissions'

/** Consultant portal (CONSULTANT V1): `/projects/{id}/external-reviews`, `/consultants`, `/progress-reports`. */

const base = (projectId: string) => `/projects/${projectId}/external-reviews`
const data = <T>(promise: Promise<{ data: { data: T } }>) => promise.then((response) => response.data.data)
const key = (projectId: string) => ['external-reviews', projectId] as const

/** True for an external party (a consultant) on the open project: they see their review workspace, not the contractor's. */
export const useIsExternalParty = () => useProjectEffectiveRole() === 'external_party'

export type ReviewStatus = 'submitted' | 'under_review' | 'returned' | 'revising' | 'responded' | 'acknowledged' | 'closed' | 'withdrawn'
export type SourceType = 'rfi' | 'submittal' | 'progress_report' | 'itp' | 'ncr' | 'closeout_deliverable'
export type Decision = 'approved' | 'approved_with_comments' | 'returned' | 'rejected'

export interface ReviewRow {
  id: string
  ref: string
  sourceType: SourceType
  sourceLabel: string
  sourceId: string
  sourceRef: string | null
  sourcePath: string | null
  title: string
  party: { id: string; name: string; discipline: string | null }
  responsible: { id: string; name: string | null }
  status: ReviewStatus
  statusLabel: string
  actionWith: { side: 'consultant' | 'contractor' | 'none'; label: string; reviewer: string | null }
  revision: number
  cycle: number
  firstSubmittedAt: string
  submittedAt: string
  submittedBy: string | null
  dueAt: string
  firstOpenedAt: string | null
  respondedAt: string | null
  acknowledgedAt: string | null
  decision: Decision | null
  decisionLabel: string | null
  openMs: number
  responseMs: number | null
  overdue: boolean
  overdueMs: number
  respondedLate: boolean
  dueInMs: number
  awaitingConsultant: boolean
  totalElapsedMs: number
  closedAt: string | null
}

export interface ReviewSummary {
  awaitingConsultant: number
  dueToday: number
  dueThisWeek: number
  overdue: number
  returnedToContractor: number
  responseReceived: number
  respondedThisWeek: number
  averageResponseMs: number | null
  medianResponseMs: number | null
  onTimePct: number | null
  oldestOpen: { id: string; ref: string; title: string; openMs: number } | null
}

export interface ReviewFile {
  id: string
  label: string
  mimeType?: string | null
  sizeBytes?: number | null
  attachmentId?: string
  uploadedBy?: string | null
  uploadedAt?: string | null
}

export interface ReviewCycle {
  id: string
  cycle: number
  revision: number
  status: 'open' | 'responded' | 'withdrawn'
  responsible: { id: string; name: string | null }
  coverNote: string | null
  snapshot: { ref?: string; title?: string; status?: string; fields?: Array<{ label: string; value: string }>; files?: ReviewFile[] }
  issuedFiles: ReviewFile[]
  submittedAt: string
  submittedBy: string | null
  dueAt: string
  firstOpenedAt: string | null
  firstOpenedBy: string | null
  respondedAt: string | null
  respondedBy: string | null
  decision: Decision | null
  decisionLabel: string | null
  responseComment: string | null
  responseFiles: ReviewFile[]
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  withdrawnAt: string | null
  withdrawReason: string | null
  openMs: number
  responseMs: number | null
  overdue: boolean
  overdueMs: number
  respondedLate: boolean
  contractorMsBefore: number | null
}

export interface ReviewDetail extends ReviewRow {
  sourceStatus: string | null
  sourceTitleNow: string | null
  recipients: Array<{ userId: string; name: string | null; role: 'responsible' | 'cc'; party: string | null }>
  decisions: Array<{ value: Decision; label: string; commentRequired: boolean }>
  cycles: ReviewCycle[]
  messages: Array<{ id: string; cycle: number; author: string | null; side: 'contractor' | 'consultant'; visibility: 'shared' | 'internal'; body: string; at: string }>
  timeline: Array<{ id: string; at: string; actor: string; side: string | null; action: string; label: string; cycle: number | null; revision: number | null; detail: string | null; reason: string | null }>
  actions: {
    decide: boolean
    attachResponse: boolean
    commentShared: boolean
    commentInternal: boolean
    acknowledge: boolean
    createRevision: boolean
    resubmit: boolean
    withdraw: boolean
    close: boolean
    reassign: boolean
    changeDueDate: boolean
  }
  reassignTo: Array<{ userId: string; name: string | null; jobTitle: string | null }>
  viewerSide: 'contractor' | 'consultant'
}

export interface ReviewFilters {
  status?: string
  sourceType?: string
  partyId?: string
  reviewerId?: string
  overdue?: string
  action?: string
  discipline?: string
  q?: string
  sort?: string
}

export interface RecipientDirectory {
  parties: Array<{ id: string; name: string; discipline: string | null; members: Array<{ userId: string; name: string | null; jobTitle: string | null; projectRole: string | null; isPrimaryReviewer: boolean }> }>
}

export interface PerformanceRow {
  key: string
  label: string
  discipline?: string | null
  open: number
  overdue: number
  completed: number
  returned: number
  averageResponseMs: number | null
  medianResponseMs: number | null
  onTimePct: number | null
}

const clean = (filters: ReviewFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''))

export const useReviewQueue = (projectId: string, filters: ReviewFilters = {}, enabled = true) =>
  useQuery<{ items: ReviewRow[]; summary: ReviewSummary; now: string; side: 'contractor' | 'consultant' }>({
    queryKey: [...key(projectId), 'list', filters],
    queryFn: () => data(apiClient.get(base(projectId), { params: clean(filters) })),
    enabled,
    refetchInterval: 60_000,
  })

export const useReviewSummary = (projectId: string, enabled = true) =>
  useQuery<ReviewSummary>({ queryKey: [...key(projectId), 'summary'], queryFn: () => data(apiClient.get(`${base(projectId)}/summary`)), enabled, refetchInterval: 60_000 })

export const useReviewPerformance = (projectId: string, filters: Record<string, string> = {}, enabled = true) =>
  useQuery<{ byParty: PerformanceRow[]; byReviewer: PerformanceRow[]; basis: string }>({
    queryKey: [...key(projectId), 'performance', filters],
    queryFn: () => data(apiClient.get(`${base(projectId)}/performance`, { params: clean(filters) })),
    enabled,
  })

export const useReviewDetail = (projectId: string, id: string | null) =>
  useQuery<ReviewDetail>({ queryKey: [...key(projectId), 'detail', id], queryFn: () => data(apiClient.get(`${base(projectId)}/${id}`)), enabled: Boolean(id) })

export const useReviewRecipients = (projectId: string, enabled = true) =>
  useQuery<RecipientDirectory>({ queryKey: [...key(projectId), 'recipients'], queryFn: () => data(apiClient.get(`${base(projectId)}/recipients`)), enabled })

export const useSourceReviews = (projectId: string, sourceType: SourceType, sourceId: string | null) =>
  useQuery<{ items: ReviewRow[]; canSubmit: boolean; documents: ReviewFile[]; decisions: Array<{ value: Decision; label: string }> }>({
    queryKey: [...key(projectId), 'source', sourceType, sourceId],
    queryFn: () => data(apiClient.get(`${base(projectId)}/source/${sourceType}/${sourceId}`)),
    enabled: Boolean(sourceId),
    retry: false,
  })

const useReviewMutation = <TVars, TResult = ReviewDetail>(projectId: string, run: (vars: TVars) => Promise<TResult>) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key(projectId) })
      queryClient.invalidateQueries({ queryKey: ['consultants', projectId] })
      queryClient.invalidateQueries({ queryKey: ['progress-reports', projectId] })
    },
  })
}

export interface SubmitInput {
  sourceType: SourceType
  sourceId: string
  partyId: string
  responsibleUserId: string
  ccUserIds: string[]
  dueAt: string
  coverNote?: string
  documentIds: string[]
}

export const useSubmitForReview = (projectId: string) => useReviewMutation<SubmitInput>(projectId, (input) => data(apiClient.post(base(projectId), input)))
export const useDecideReview = (projectId: string) => useReviewMutation<{ id: string; decision: Decision; comment?: string }>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/${id}/decision`, body)))
export const useAcknowledgeReview = (projectId: string) => useReviewMutation<string>(projectId, (id) => data(apiClient.post(`${base(projectId)}/${id}/acknowledge`, {})))
export const useCreateReviewRevision = (projectId: string) => useReviewMutation<{ id: string; reason?: string }>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/${id}/revision`, body)))
export const useResubmitReview = (projectId: string) => useReviewMutation<{ id: string; dueAt: string; coverNote?: string; documentIds?: string[]; responsibleUserId?: string }>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/${id}/resubmit`, body)))
export const useWithdrawReview = (projectId: string) => useReviewMutation<{ id: string; reason: string }>(projectId, ({ id, reason }) => data(apiClient.post(`${base(projectId)}/${id}/withdraw`, { reason })))
export const useCloseReview = (projectId: string) => useReviewMutation<{ id: string; reason?: string }>(projectId, ({ id, reason }) => data(apiClient.post(`${base(projectId)}/${id}/close`, { reason })))
export const useReassignReview = (projectId: string) => useReviewMutation<{ id: string; responsibleUserId: string; reason: string }>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/${id}/reassign`, body)))
export const useChangeReviewDue = (projectId: string) => useReviewMutation<{ id: string; dueAt: string; reason: string }>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/${id}/due-date`, body)))
export const useAddReviewMessage = (projectId: string) => useReviewMutation<{ id: string; body: string; visibility: 'shared' | 'internal' }>(projectId, ({ id, ...body }) => data(apiClient.post(`${base(projectId)}/${id}/messages`, body)))

export const reviewFileUrl = (projectId: string, id: string, documentId: string) => `${base(projectId)}/${id}/files/${documentId}`
export const reviewExportUrl = (projectId: string, format: 'xlsx' | 'csv', filters: ReviewFilters = {}) => {
  const params = new URLSearchParams({ format, ...(clean(filters) as Record<string, string>) })
  return `${base(projectId)}/export?${params}`
}

// ─── consultants ──────────────────────────────────────────────────────────

export type AccessLevel = 'read_only' | 'none'
export interface AccessSelection {
  modules: Record<string, AccessLevel>
  reviews: SourceType[]
  comment: boolean
}
export interface ConsultantsOverview {
  types: Record<string, string>
  modules: Array<{ module: string; label: string; review: SourceType | null }>
  templates: Array<{ key: string; id: string; name: string; description: string; selection: AccessSelection }>
  parties: Array<{
    id: string
    name: string
    discipline: string | null
    disciplineLabel: string
    status: string
    contactName: string | null
    contactEmail: string | null
    members: Array<{ userId: string; name: string | null; email: string | null; status: string; jobTitle: string | null; projectRole: string | null; isPrimaryReviewer: boolean; acceptedAt: string | null; access: { templateKey: string | null; template: string; customised: boolean; selection: AccessSelection | null } }>
    pendingInvitations: Array<{ id: string; email: string; invitedAt: string; expiresAt: string | null; contactName: string | null; jobTitle: string | null; template: string | null }>
  }>
}

export interface InviteInput {
  companyName: string
  discipline: string
  contactName?: string
  email: string
  jobTitle?: string
  projectRole?: string
  isPrimaryReviewer: boolean
  notes?: string
  templateKey: string
  access?: AccessSelection | null
}

export const useConsultants = (projectId: string, enabled = true) =>
  useQuery<ConsultantsOverview>({ queryKey: ['consultants', projectId], queryFn: () => data(apiClient.get(`/projects/${projectId}/consultants`)), enabled })

export const useInviteConsultant = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InviteInput) => data<{ invitation: { id: string; email: string }; party: { id: string; name: string }; access: { template: string; customised: boolean } }>(apiClient.post(`/projects/${projectId}/consultants/invitations`, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consultants', projectId] }),
  })
}

export const useSetConsultantAccess = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; templateKey: string; access: AccessSelection; isPrimaryReviewer?: boolean }) => data(apiClient.put(`/projects/${projectId}/consultants/members/${userId}/access`, body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consultants', projectId] }),
  })
}

// ─── progress reports ─────────────────────────────────────────────────────

export interface ProgressReport {
  id: string
  ref: string
  kind: string
  period: string
  title: string
  summary: string | null
  status: 'draft' | 'issued'
  revision: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export const useProgressReports = (projectId: string, enabled = true) =>
  useQuery<{ items: ProgressReport[] }>({ queryKey: ['progress-reports', projectId], queryFn: () => data(apiClient.get(`/projects/${projectId}/progress-reports`)), enabled })

export const useCreateProgressReport = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { period: string; title?: string; summary?: string }) => data<ProgressReport>(apiClient.post(`/projects/${projectId}/progress-reports`, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-reports', projectId] }),
  })
}

export const useUpdateProgressReport = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; summary?: string }) => data<ProgressReport>(apiClient.patch(`/projects/${projectId}/progress-reports/${id}`, body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-reports', projectId] }),
  })
}
