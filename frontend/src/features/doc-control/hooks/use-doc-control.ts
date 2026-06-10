import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { WorkflowRecordMeta } from '@/features/workflows/components/workflow-record-list'

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
}

export interface SubmittalRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  title: string
  revision: string
  status: 'pending' | 'under_review' | 'approved' | 'resubmit' | 'rejected'
  dueDate?: string | null
  remarks?: string | null
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
const rfiKey = (projectId: string) => ['rfi', projectId]
const rfiListKey = (projectId: string, query: RfiListQuery) => [
  ...rfiKey(projectId),
  query,
]
const submittalKey = (projectId: string) => ['submittals', projectId]
const submittalListKey = (
  projectId: string,
  query: SubmittalListQuery
) => [...submittalKey(projectId), query]
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

export const useCreateRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { subject: string; owner?: string; dueDate?: string }) =>
      apiClient
        .post(`/projects/${projectId}/rfi`, payload)
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      qc.invalidateQueries({ queryKey: docDashboardKey(projectId) })
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
    mutationFn: (payload: { title: string; owner?: string; dueDate?: string }) =>
      apiClient
        .post(`/projects/${projectId}/submittals`, payload)
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      qc.invalidateQueries({ queryKey: docDashboardKey(projectId) })
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
      qc.invalidateQueries({ queryKey: docDashboardKey(projectId) })
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
      qc.invalidateQueries({ queryKey: docDashboardKey(projectId) })
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
      qc.invalidateQueries({ queryKey: docDashboardKey(projectId) })
    },
  })
}
