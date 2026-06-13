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

export interface RfiRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  subject: string
  status: 'open' | 'answered' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  question?: string | null
  response?: string | null
  dueDate?: string | null
  responseRequiredBy?: string | null
  ownerPartyId?: string | null
  reviewerPartyId?: string | null
  approverPartyId?: string | null
  ownerParty?: { id: string; role: string; companyName?: string | null } | null
  reviewerParty?: { id: string; role: string; companyName?: string | null } | null
  approverParty?: { id: string; role: string; companyName?: string | null } | null
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
  reviewerParty?: { id: string; role: string; companyName?: string | null } | null
  approverParty?: { id: string; role: string; companyName?: string | null } | null
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
    mutationFn: (payload: {
      subject: string
      owner?: string
      ownerPartyId?: string
      reviewerPartyId?: string
      approverPartyId?: string
      dueDate?: string
    }) =>
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
