import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  WorkflowRecordMeta,
  WorkflowRevision,
} from '@/features/workflows/components/workflow-record-list'

export interface DocControlDashboardData {
  metrics: {
    rfiOpen: number
    rfiOverdue: number
    avgRfiTurnaroundDays: number
    submittalPending: number
    submittalResubmit: number
    drawingsActive: number
    drawingsSuperseded: number
    transmittalPendingAck: number
    contractualNotices: number
    dueAlerts: number
    overdue: number
  }
}

export interface RfiPerson {
  id: string
  name: string
  email?: string | null
}

export interface RfiListedPerson extends RfiPerson {
  userId: string
  sortOrder: number
}

export interface RfiResponse {
  id: string
  rfiId: string
  body: string
  isOfficial: boolean
  revision: number
  authorId: string | null
  author: RfiPerson | null
  createdAt: string
  updatedAt: string
}

export type RfiStatus = 'draft' | 'open' | 'answered' | 'closed'

export interface RfiRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  subject: string
  status: RfiStatus
  priority: 'low' | 'normal' | 'high' | 'urgent'
  question?: string | null
  response?: string | null
  discipline?: string | null
  dueDate?: string | null
  responseRequiredBy?: string | null
  raisedDate?: string | null
  answeredDate?: string | null
  answeredBy?: string | null
  activityId?: string | null
  activity?: { id: string; name: string } | null
  ownerPartyId?: string | null
  reviewerPartyId?: string | null
  approverPartyId?: string | null
  ownerParty?: { id: string; role: string; companyName?: string | null } | null
  reviewerParty?: {
    id: string
    role: string
    companyName?: string | null
  } | null
  approverParty?: {
    id: string
    role: string
    companyName?: string | null
  } | null
  ballInCourtUserId?: string | null
  ballInCourtUser?: RfiPerson | null
  assigneeUser?: RfiPerson | null
  ownerUser?: RfiPerson | null
  // OCTA-PM-RFI-016
  managerUserId?: string | null
  manager?: RfiPerson | null
  createdBy?: string | null
  specSection?: string | null
  locationId?: string | null
  location?: { id: string; name: string; code?: string | null } | null
  costImpact?: boolean
  costImpactAmount?: number | null
  scheduleImpactFlag?: boolean
  scheduleImpact?: number
  revision?: number
  officialResponseId?: string | null
  changeOrderId?: string | null
  isOverdue?: boolean
  assignees?: RfiListedPerson[]
  distribution?: RfiListedPerson[]
  responses?: RfiResponse[]
  officialResponse?: RfiResponse | null
  path?: string | null
}

export interface RfiUpgradeFields {
  managerUserId?: string | null
  assigneeUserIds?: string[]
  distributionUserIds?: string[]
  specSection?: string | null
  locationId?: string | null
  costImpact?: boolean
  costImpactAmount?: number | null
  scheduleImpactFlag?: boolean
  scheduleImpact?: number
  question?: string | null
  discipline?: string | null
  responseRequiredBy?: string | null
  dueDate?: string | null
  activityId?: string | null
  priority?: RfiRecord['priority']
  subject?: string
  status?: 'draft' | 'open'
}

export type SubmittalResponseCode =
  | 'approved'
  | 'approved_as_noted'
  | 'revise_resubmit'
  | 'rejected'
  | 'custom'

export interface SubmittalStepAssignee {
  type: 'user' | 'party_role' | 'role'
  userId?: string | null
  role?: string | null
}

export interface SubmittalWorkflowStep {
  name: string
  mode: 'sequential' | 'parallel'
  days: number
  assignees: SubmittalStepAssignee[]
}

export interface SubmittalWorkflowTemplate {
  id: string
  projectId: string | null
  scope: 'company' | 'project'
  name: string
  description?: string | null
  isDefault: boolean
  status: 'active' | 'archived'
  steps: SubmittalWorkflowStep[]
  reviewDays: number
  editable: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export interface SubmittalWorkflowTemplateInput {
  name?: string
  description?: string | null
  isDefault?: boolean
  status?: 'active' | 'archived'
  steps?: SubmittalWorkflowStep[]
}

export interface SubmittalStepAssignment {
  id: string
  userId: string
  user?: RfiPerson | null
  role: string
  status: 'pending' | 'approved' | 'rejected' | 'skipped'
  responseCode?: string | null
  responseCodeLabel?: string | null
  comment?: string | null
  decidedAt?: string | null
}

export interface SubmittalStep {
  id: string
  revisionNumber: number
  sortOrder: number
  name: string
  mode: 'sequential' | 'parallel'
  days: number
  status: 'pending' | 'active' | 'approved' | 'rejected' | 'skipped'
  startedAt?: string | null
  dueAt?: string | null
  completedAt?: string | null
  isLate: boolean
  assignments: SubmittalStepAssignment[]
}

export interface SubmittalPackageItem {
  id: string
  ref: string
  title: string
  status: SubmittalRecord['status']
  revision?: string | null
  revisionNumber: number
  responseCode?: string | null
  responseCodeLabel?: string | null
  currentStepId?: string | null
  ballInCourtUserId?: string | null
  dueDate?: string | null
}

export interface SubmittalPackage {
  id: string
  projectId: string
  number: number
  ref: string
  name: string
  description?: string | null
  status: 'open' | 'submitted' | 'closed'
  activityId?: string | null
  activity?: { id: string; name: string; startDate?: string | null } | null
  requiredOnSite?: string | null
  managerUserId?: string | null
  manager?: RfiPerson | null
  items: SubmittalPackageItem[]
  summary: {
    total: number
    underReview: number
    approved: number
    returned: number
  }
  createdAt?: string | null
  updatedAt?: string | null
}

export interface SubmittalPackageInput {
  name?: string
  description?: string | null
  activityId?: string | null
  requiredOnSite?: string | null
  managerUserId?: string | null
  submittalIds?: string[]
}

export interface SubmittalDecision {
  decision: 'approve' | 'reject'
  responseCode?: SubmittalResponseCode
  responseCodeLabel?: string | null
  comment?: string | null
}

export interface SubmittalPackageActionResult {
  package: SubmittalPackage
  results: Array<{
    submittalId: string
    ref: string
    submitted?: boolean
    decided?: boolean
    skipped?: boolean
    reason?: string | null
    error?: string | null
  }>
}

/** Fields added by OCTA-PM-SUB-017; accepted on create and PATCH. */
export interface SubmittalUpgradeFields {
  title?: string
  discipline?: string | null
  specRef?: string | null
  revision?: string | null
  activityId?: string | null
  dueDate?: string | null
  remarks?: string | null
  packageId?: string | null
  workflowTemplateId?: string | null
  leadTimeWeeks?: number | null
  reviewDays?: number | null
  requiredOnSite?: string | null
  managerUserId?: string | null
  distributionUserIds?: string[]
  ownerPartyId?: string | null
  reviewerPartyId?: string | null
  approverPartyId?: string | null
  comment?: string
}

export interface SubmittalRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  title: string
  revision: string
  status: 'pending' | 'under_review' | 'approved' | 'resubmit' | 'rejected'
  dueDate?: string | null
  remarks?: string | null
  discipline?: string | null
  specRef?: string | null
  activityId?: string | null
  packageId?: string | null
  workflowTemplateId?: string | null
  currentStepId?: string | null
  responseCode?: SubmittalResponseCode | null
  responseCodeLabel?: string | null
  revisionNumber?: number
  leadTimeWeeks?: number | null
  reviewDays?: number | null
  requiredOnSite?: string | null
  submitBy?: string | null
  scheduleImpactDays?: number
  managerUserId?: string | null
  createdBy?: string | null
  distributedAt?: string | null
  ballInCourtUserId?: string | null
  ownerUserId?: string | null
  updatedAt?: string | null
  ownerPartyId?: string | null
  reviewerPartyId?: string | null
  approverPartyId?: string | null
  ownerParty?: { id: string; role: string; companyName?: string | null } | null
  reviewerParty?: {
    id: string
    role: string
    companyName?: string | null
  } | null
  approverParty?: {
    id: string
    role: string
    companyName?: string | null
  } | null
}

export interface DrawingRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  drawingNumber: string
  title: string
  revision: string
  status: 'active' | 'superseded' | 'cancelled'
  dueDate?: string | null
}

export interface TransmittalRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  subject: string
  status: 'pending_ack' | 'acknowledged'
  dueDate?: string | null
}

export interface CorrespondenceRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  direction: 'incoming' | 'outgoing'
  type: 'letter' | 'email' | 'memo' | 'notice'
  recordTypeKey?: string | null
  subject: string
  status: 'open' | 'closed'
  dueDate?: string | null
  responseRequiredBy?: string | null
}

export type DocumentRegisterRecordType =
  | 'rfi'
  | 'submittal'
  | 'drawing'
  | 'transmittal'
  | 'correspondence'

export interface DocumentRegisterRow extends WorkflowRecordMeta {
  id: string
  recordType: DocumentRegisterRecordType
  recordId: string
  ref: string
  title: string
  documentNumber?: string | null
  category?: string | null
  folderPath?: string | null
  folderKey?: string | null
  restrictedToCurrentRevision?: boolean
  status?: string | null
  currentRevision?: string | null
  latestRevision?: WorkflowRevision | null
  revisions: WorkflowRevision[]
  revisionCount: number
  supersededRevisionCount: number
  attachmentCount: number
  updatedAt?: string | null
}

export interface DocumentRegisterQuery {
  recordType?: DocumentRegisterRecordType | 'all'
  folder?: string
  category?: string
  status?: string
  search?: string
}

export interface DocumentRegisterFolder {
  key: string
  label: string
  recordTypes: DocumentRegisterRecordType[]
  count: number
}

export interface DocumentRegisterResponse {
  rows: DocumentRegisterRow[]
  folders: DocumentRegisterFolder[]
  summary: {
    records: number
    latestApproved: number
    supersededRevisions: number
    missingRevision: number
    currentOnly?: boolean
  }
}

export interface CursorPagination {
  limit: number
  nextCursor: string | null
}

export interface CursorRowsResponse<T> {
  rows: T[]
  summary?: Record<string, number>
  pagination?: CursorPagination
}

export interface RfiListQuery {
  cursor?: string | null
  limit?: number
  status?: RfiRecord['status'] | 'all'
  priority?: RfiRecord['priority'] | 'all'
  search?: string
  managerUserId?: string | null
  assigneeUserId?: string | null
  /** A user id or `me`. */
  ballInCourtUserId?: string | null
  locationId?: string | null
  overdue?: boolean
  sortBy?:
    | 'created'
    | 'updated'
    | 'dueDate'
    | 'raisedDate'
    | 'responseRequiredBy'
    | 'answeredDate'
    | 'priority'
    | 'status'
    | 'ref'
  sortDir?: 'asc' | 'desc'
}

export interface SubmittalDetail extends SubmittalRecord {
  package?: {
    id: string
    ref: string
    name: string
    status: SubmittalPackage['status']
  } | null
  workflowTemplate?: { id: string; name: string; reviewDays: number } | null
  manager?: RfiPerson | null
  activity?: { id: string; name: string; startDate?: string | null } | null
  distribution: RfiPerson[]
  distributionUserIds: string[]
  reviewSteps: SubmittalStep[]
  currentRevisionSteps: SubmittalStep[]
  activeStep: SubmittalStep | null
  lateSteps: number
  isLate: boolean
  path: string
}

export interface SubmittalListQuery {
  cursor?: string | null
  limit?: number
  status?: SubmittalRecord['status'] | 'all'
  search?: string
  packageId?: string | null
  managerUserId?: string | null
  ballInCourtUserId?: string | null
  workflowTemplateId?: string | null
  responseCode?: SubmittalResponseCode | 'all'
  overdue?: boolean
  sortBy?:
    | 'created'
    | 'updated'
    | 'dueDate'
    | 'submittedOn'
    | 'reviewedOn'
    | 'status'
    | 'ref'
    | 'title'
  sortDir?: 'asc' | 'desc'
}

const docDashboardKey = (projectId: string) => ['doc-dashboard', projectId]
const documentRegisterKey = (projectId: string) => ['doc-register', projectId]
const documentRegisterListKey = (
  projectId: string,
  query: DocumentRegisterQuery
) => [...documentRegisterKey(projectId), query]
const rfiKey = (projectId: string) => ['rfi', projectId]
const rfiListKey = (projectId: string, query: RfiListQuery) => [
  ...rfiKey(projectId),
  query,
]
const submittalKey = (projectId: string) => ['submittals', projectId]
const submittalListKey = (projectId: string, query: SubmittalListQuery) => [
  ...submittalKey(projectId),
  query,
]
const submittalDetailKey = (projectId: string, submittalId: string) => [
  'submittal-detail',
  projectId,
  submittalId,
]
const submittalPackagesKey = (projectId: string) => [
  'submittal-packages',
  projectId,
]
const submittalTemplatesKey = (projectId: string | null) => [
  'submittal-workflow-templates',
  projectId ?? 'company',
]
const drawingKey = (projectId: string) => ['drawings', projectId]
const transmittalKey = (projectId: string) => ['transmittals', projectId]
const correspondenceKey = (projectId: string) => ['correspondence', projectId]

const cleanListParams = (query: RfiListQuery | SubmittalListQuery) =>
  Object.fromEntries(
    Object.entries(query as Record<string, unknown>).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false
      return value !== 'all'
    })
  )

const cleanParams = (query: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(query).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false
      return value !== 'all'
    })
  )

const invalidateDocControl = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: docDashboardKey(projectId) })
  qc.invalidateQueries({ queryKey: documentRegisterKey(projectId) })
}

export const useDocControlDashboard = (projectId: string) =>
  useQuery<DocControlDashboardData>({
    queryKey: docDashboardKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/doc-control/dashboard`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useRfis = (projectId: string, query: RfiListQuery = {}) =>
  useQuery<CursorRowsResponse<RfiRecord>>({
    queryKey: rfiListKey(projectId, query),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/rfi`, { params: cleanListParams(query) })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export interface ProjectEvidenceItem {
  documentId: string
  attachmentId: string
  recordType: string
  recordId: string
  recordRef: string | null
  recordTitle: string | null
  recordStatus: string | null
  role: string
  caption: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  uploadedAt: string | null
  fileUrl: string | null
}

/**
 * Evidence already attached to the project's records — RFI letters, NCR
 * photos, submittal transmittals — that a change order can cite without a
 * second upload (Phase 22B). The API applies the viewer's own visibility.
 */
export const useProjectEvidence = (projectId: string, search?: string) =>
  useQuery<{ items: ProjectEvidenceItem[] }>({
    queryKey: ['project-evidence', projectId, search || ''],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/attachments/search`, {
          params: { q: search || undefined, limit: 40 },
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  })

export const useDocumentRegister = (
  projectId: string,
  query: DocumentRegisterQuery = {}
) =>
  useQuery<DocumentRegisterResponse>({
    queryKey: documentRegisterListKey(projectId, query),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/doc-control/register`, {
          params: cleanParams(query as Record<string, unknown>),
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: {
        subject: string
        owner?: string
        ownerPartyId?: string
        reviewerPartyId?: string
        approverPartyId?: string
        dueDate?: string
      } & RfiUpgradeFields
    ) =>
      apiClient
        .post(`/projects/${projectId}/rfi`, payload)
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useSubmitRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rfiId, comment }: { rfiId: string; comment?: string }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/submit`, { comment })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useAnswerRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      payload,
    }: {
      rfiId: string
      payload: {
        response: string
        comment?: string
        revision?: string
        projectDocumentId?: string
        documentId?: string
        storageKey?: string
        attachmentRefs?: unknown[]
        activityLinks?: unknown[]
      }
    }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/answer`, payload)
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useApproveRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rfiId, comment }: { rfiId: string; comment?: string }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/approve`, { comment })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useCloseRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rfiId, comment }: { rfiId: string; comment: string }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/close`, { comment })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

// ─── OCTA-PM-RFI-016: detail, people, responses, change event, PDF ────────

const rfiDetailKey = (projectId: string, rfiId: string) => [
  'rfi-detail',
  projectId,
  rfiId,
]

const invalidateRfi = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: rfiKey(projectId) })
  qc.invalidateQueries({ queryKey: ['rfi-detail', projectId] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
  qc.invalidateQueries({ queryKey: ['change-orders', projectId] })
  invalidateDocControl(qc, projectId)
}

export const useRfi = (projectId: string, rfiId: string | null) =>
  useQuery<RfiRecord>({
    queryKey: rfiDetailKey(projectId, rfiId ?? ''),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/rfi/${rfiId}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId && rfiId),
  })

export const useUpdateRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      payload,
    }: {
      rfiId: string
      payload: RfiUpgradeFields & { comment?: string }
    }) =>
      apiClient
        .patch(`/projects/${projectId}/rfi/${rfiId}`, payload)
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => invalidateRfi(qc, projectId),
  })
}

export const useUpdateRfiPeople = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      managerUserId,
      assigneeUserIds,
      distributionUserIds,
    }: {
      rfiId: string
      managerUserId?: string | null
      assigneeUserIds?: string[]
      distributionUserIds?: string[]
    }) =>
      apiClient
        .put(`/projects/${projectId}/rfi/${rfiId}/people`, {
          managerUserId,
          assigneeUserIds,
          distributionUserIds,
        })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => invalidateRfi(qc, projectId),
  })
}

export const useAddRfiResponse = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      body,
      isOfficial,
    }: {
      rfiId: string
      body: string
      isOfficial?: boolean
    }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/responses`, {
          body,
          isOfficial: Boolean(isOfficial),
        })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => invalidateRfi(qc, projectId),
  })
}

export const useSetOfficialRfiResponse = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      responseId,
    }: {
      rfiId: string
      responseId: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/rfi/${rfiId}/responses/${responseId}/official`
        )
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => invalidateRfi(qc, projectId),
  })
}

export const useUpdateRfiResponse = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      responseId,
      body,
    }: {
      rfiId: string
      responseId: string
      body: string
    }) =>
      apiClient
        .patch(`/projects/${projectId}/rfi/${rfiId}/responses/${responseId}`, {
          body,
        })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => invalidateRfi(qc, projectId),
  })
}

export const useDeleteRfiResponse = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      responseId,
    }: {
      rfiId: string
      responseId: string
    }) =>
      apiClient
        .delete(`/projects/${projectId}/rfi/${rfiId}/responses/${responseId}`)
        .then((response) => response.data.data as { deleted: boolean }),
    onSuccess: () => invalidateRfi(qc, projectId),
  })
}

export const useConvertRfiToChange = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      rfiId,
      description,
      value,
    }: {
      rfiId: string
      description?: string | null
      value?: number | null
    }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/convert-to-change`, {
          description: description || undefined,
          value: value ?? undefined,
        })
        .then(
          (response) =>
            response.data.data as {
              changeOrder: { id: string; ref: string }
              rfi: RfiRecord
            }
        ),
    onSuccess: () => invalidateRfi(qc, projectId),
  })
}

/** Downloads the RFI (question, official response, thread) as PDF. */
export const downloadRfiPdf = async (projectId: string, rfiId: string) => {
  const response = await apiClient.get(
    `/projects/${projectId}/rfi/${rfiId}/export.pdf`,
    { responseType: 'blob', timeout: 120_000 }
  )
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const fileName = match?.[1] ?? 'rfi.pdf'
  const url = URL.createObjectURL(
    new Blob([response.data], { type: 'application/pdf' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return fileName
}

export const useReopenRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rfiId, reason }: { rfiId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/reopen`, { reason })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useRejectRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rfiId, reason }: { rfiId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/rfi/${rfiId}/reject`, { reason })
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useSubmittals = (
  projectId: string,
  query: SubmittalListQuery = {}
) =>
  useQuery<CursorRowsResponse<SubmittalRecord>>({
    queryKey: submittalListKey(projectId, query),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/submittals`, {
          params: cleanListParams(query),
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

const invalidateSubmittals = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: submittalKey(projectId) })
  qc.invalidateQueries({ queryKey: ['submittal-detail', projectId] })
  qc.invalidateQueries({ queryKey: submittalPackagesKey(projectId) })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
  invalidateDocControl(qc, projectId)
}

export const useCreateSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: SubmittalUpgradeFields & {
        title: string
        owner?: string
        status?: 'pending' | 'under_review'
      }
    ) =>
      apiClient
        .post(`/projects/${projectId}/submittals`, payload)
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useSubmittal = (projectId: string, submittalId: string | null) =>
  useQuery<SubmittalDetail>({
    queryKey: submittalDetailKey(projectId, submittalId ?? ''),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/submittals/${submittalId}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId && submittalId),
  })

export const useUpdateSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      payload,
    }: {
      submittalId: string
      payload: SubmittalUpgradeFields
    }) =>
      apiClient
        .patch(`/projects/${projectId}/submittals/${submittalId}`, payload)
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useUpdateSubmittalPeople = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      managerUserId,
      distributionUserIds,
    }: {
      submittalId: string
      managerUserId?: string | null
      distributionUserIds?: string[]
    }) =>
      apiClient
        .put(`/projects/${projectId}/submittals/${submittalId}/people`, {
          managerUserId,
          distributionUserIds,
        })
        .then((response) => response.data.data as SubmittalDetail),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useDecideSubmittalStep = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      payload,
    }: {
      submittalId: string
      payload: SubmittalDecision
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/submittals/${submittalId}/decide`,
          payload
        )
        .then((response) => response.data.data as SubmittalDetail),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useSubmittalPackages = (
  projectId: string,
  query: { status?: SubmittalPackage['status'] | 'all' } = {}
) =>
  useQuery<{ items: SubmittalPackage[] }>({
    queryKey: [...submittalPackagesKey(projectId), query],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/submittals/packages`, {
          params: cleanParams(query),
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateSubmittalPackage = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SubmittalPackageInput & { name: string }) =>
      apiClient
        .post(`/projects/${projectId}/submittals/packages`, payload)
        .then((response) => response.data.data as SubmittalPackage),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useUpdateSubmittalPackage = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      payload,
    }: {
      packageId: string
      payload: SubmittalPackageInput
    }) =>
      apiClient
        .patch(
          `/projects/${projectId}/submittals/packages/${packageId}`,
          payload
        )
        .then((response) => response.data.data as SubmittalPackage),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useAddSubmittalPackageItems = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      submittalIds,
    }: {
      packageId: string
      submittalIds: string[]
    }) =>
      apiClient
        .post(`/projects/${projectId}/submittals/packages/${packageId}/items`, {
          submittalIds,
        })
        .then((response) => response.data.data as SubmittalPackage),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useRemoveSubmittalPackageItem = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      submittalId,
    }: {
      packageId: string
      submittalId: string
    }) =>
      apiClient
        .delete(
          `/projects/${projectId}/submittals/packages/${packageId}/items/${submittalId}`
        )
        .then((response) => response.data.data as SubmittalPackage),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useSubmitSubmittalPackage = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      comment,
    }: {
      packageId: string
      comment?: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/submittals/packages/${packageId}/submit`,
          {
            comment,
          }
        )
        .then((response) => response.data.data as SubmittalPackageActionResult),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

export const useDecideSubmittalPackage = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      payload,
    }: {
      packageId: string
      payload: SubmittalDecision
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/submittals/packages/${packageId}/decide`,
          payload
        )
        .then((response) => response.data.data as SubmittalPackageActionResult),
    onSuccess: () => invalidateSubmittals(qc, projectId),
  })
}

const submittalTemplatesBase = (projectId: string | null) =>
  projectId
    ? `/projects/${projectId}/submittals/workflow-templates`
    : '/company/submittal-workflow-templates'

/** Project scope lists project + company workflows; `null` lists the company library. */
export const useSubmittalWorkflowTemplates = (
  projectId: string | null,
  query: {
    includeArchived?: boolean
    scope?: 'all' | 'project' | 'company'
  } = {}
) =>
  useQuery<{ items: SubmittalWorkflowTemplate[] }>({
    queryKey: [...submittalTemplatesKey(projectId), query],
    queryFn: () =>
      apiClient
        .get(submittalTemplatesBase(projectId), { params: cleanParams(query) })
        .then((response) => response.data.data),
  })

export const useCreateSubmittalWorkflowTemplate = (
  projectId: string | null
) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SubmittalWorkflowTemplateInput & { name: string }) =>
      apiClient
        .post(submittalTemplatesBase(projectId), payload)
        .then((response) => response.data.data as SubmittalWorkflowTemplate),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['submittal-workflow-templates'] }),
  })
}

export const useUpdateSubmittalWorkflowTemplate = (
  projectId: string | null
) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      templateId,
      payload,
    }: {
      templateId: string
      payload: SubmittalWorkflowTemplateInput
    }) =>
      apiClient
        .patch(`${submittalTemplatesBase(projectId)}/${templateId}`, payload)
        .then((response) => response.data.data as SubmittalWorkflowTemplate),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['submittal-workflow-templates'] }),
  })
}

export const useArchiveSubmittalWorkflowTemplate = (
  projectId: string | null
) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string) =>
      apiClient
        .delete(`${submittalTemplatesBase(projectId)}/${templateId}`)
        .then((response) => response.data.data as SubmittalWorkflowTemplate),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['submittal-workflow-templates'] }),
  })
}

export const useSeedSubmittalWorkflowTemplates = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient.post('/company/submittal-workflow-templates/starters').then(
        (response) =>
          response.data.data as {
            created: number
            items: SubmittalWorkflowTemplate[]
          }
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['submittal-workflow-templates'] }),
  })
}

export const useSubmitSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      payload,
    }: {
      submittalId: string
      payload: {
        revision?: string
        comment?: string
        projectDocumentId?: string
        documentId?: string
        storageKey?: string
        attachmentRefs?: unknown[]
      }
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/submittals/${submittalId}/submit`,
          payload
        )
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useReviewSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      comment,
    }: {
      submittalId: string
      comment: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/submittals/${submittalId}/review`, {
          comment,
        })
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useResubmitSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      payload,
    }: {
      submittalId: string
      payload: {
        revision?: string
        comment?: string
        reason?: string
        projectDocumentId?: string
        documentId?: string
        storageKey?: string
        attachmentRefs?: unknown[]
      }
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/submittals/${submittalId}/resubmit`,
          payload
        )
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useApproveSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      comment,
    }: {
      submittalId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/submittals/${submittalId}/approve`, {
          comment,
        })
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useRejectSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      submittalId,
      reason,
    }: {
      submittalId: string
      reason: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/submittals/${submittalId}/reject`, {
          reason,
        })
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useUploadDocumentRevision = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      recordType,
      recordId,
      payload,
    }: {
      recordType: Exclude<DocumentRegisterRecordType, 'correspondence'>
      recordId: string
      payload: {
        revision: string
        projectDocumentId?: string
        documentId?: string
        storageKey?: string
        title?: string
        notes?: string
      }
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/doc-control/${recordType}/${recordId}/revisions`,
          payload
        )
        .then((response) => response.data.data as WorkflowRevision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useUploadDocumentRevisionFile = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      recordType,
      recordId,
      file,
      payload,
    }: {
      recordType: Exclude<DocumentRegisterRecordType, 'correspondence'>
      recordId: string
      file: File
      payload: {
        revision: string
        title?: string
        documentNumber?: string
        category?: string
        folderPath?: string
        discipline?: string
        reviewDueAt?: string
        status?: 'uploaded' | 'submitted'
        notes?: string
      }
    }) => {
      const formData = new FormData()
      formData.append('file', file)
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          formData.append(key, String(value))
        }
      })
      return apiClient
        .post(
          `/projects/${projectId}/doc-control/${recordType}/${recordId}/revisions/upload`,
          formData
        )
        .then(
          (response) =>
            response.data.data as {
              revision: WorkflowRevision
              document: unknown
            }
        )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useSubmitDocumentRevisionForReview = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      revisionId,
      comment,
      reviewDueAt,
    }: {
      revisionId: string
      comment?: string
      reviewDueAt?: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/doc-control/revisions/${revisionId}/submit-review`,
          {
            comment,
            reviewDueAt,
          }
        )
        .then((response) => response.data.data as WorkflowRevision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useApproveDocumentRevision = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      revisionId,
      comment,
    }: {
      revisionId: string
      comment?: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/doc-control/revisions/${revisionId}/approve`,
          {
            comment,
          }
        )
        .then((response) => response.data.data as WorkflowRevision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useSupersedeDocumentRevision = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      revisionId,
      reason,
    }: {
      revisionId: string
      reason: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/doc-control/revisions/${revisionId}/supersede`,
          { reason }
        )
        .then((response) => response.data.data as WorkflowRevision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useDrawings = (projectId: string) =>
  useQuery<{ rows: DrawingRecord[] }>({
    queryKey: drawingKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/drawings`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateDrawing = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      drawingNumber: string
      title: string
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/drawings`, payload)
        .then((response) => response.data.data as DrawingRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: drawingKey(projectId) })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useTransmittals = (projectId: string) =>
  useQuery<{ rows: TransmittalRecord[] }>({
    queryKey: transmittalKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/transmittals`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateTransmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      subject: string
      sender: string
      recipient: string
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/transmittals`, payload)
        .then((response) => response.data.data as TransmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: transmittalKey(projectId) })
      invalidateDocControl(qc, projectId)
    },
  })
}

export const useCorrespondence = (projectId: string) =>
  useQuery<{ rows: CorrespondenceRecord[] }>({
    queryKey: correspondenceKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/correspondence`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateCorrespondence = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      direction: 'incoming' | 'outgoing'
      type: 'letter' | 'email' | 'memo' | 'notice'
      recordTypeKey?: string | null
      subject: string
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/correspondence`, payload)
        .then((response) => response.data.data as CorrespondenceRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correspondenceKey(projectId) })
      invalidateDocControl(qc, projectId)
    },
  })
}
