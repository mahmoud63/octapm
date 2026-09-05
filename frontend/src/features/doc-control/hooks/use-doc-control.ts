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

export interface SubmittalRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  title: string
  revision: string
  status: 'pending' | 'under_review' | 'approved' | 'resubmit' | 'rejected'
  dueDate?: string | null
  remarks?: string | null
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

export interface SubmittalListQuery {
  cursor?: string | null
  limit?: number
  status?: SubmittalRecord['status'] | 'all'
  search?: string
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

export const useCreateSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      title: string
      owner?: string
      ownerPartyId?: string
      reviewerPartyId?: string
      approverPartyId?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/submittals`, payload)
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      invalidateDocControl(qc, projectId)
    },
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
