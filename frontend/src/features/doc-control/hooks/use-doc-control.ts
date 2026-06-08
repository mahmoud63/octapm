import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

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
  }
}

export interface RfiRecord {
  id: string
  ref: string
  subject: string
  status: 'open' | 'answered' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
}

export interface SubmittalRecord {
  id: string
  ref: string
  title: string
  status: 'pending' | 'under_review' | 'approved' | 'resubmit' | 'rejected'
}

export interface DrawingRecord {
  id: string
  ref: string
  drawingNumber: string
  title: string
  status: 'active' | 'superseded' | 'cancelled'
}

export interface TransmittalRecord {
  id: string
  ref: string
  subject: string
  status: 'pending_ack' | 'acknowledged'
}

export interface CorrespondenceRecord {
  id: string
  ref: string
  direction: 'incoming' | 'outgoing'
  type: 'letter' | 'email' | 'memo' | 'notice'
  subject: string
  status: 'open' | 'closed'
}

const docDashboardKey = (projectId: string) => ['doc-dashboard', projectId]
const rfiKey = (projectId: string) => ['rfi', projectId]
const submittalKey = (projectId: string) => ['submittals', projectId]
const drawingKey = (projectId: string) => ['drawings', projectId]
const transmittalKey = (projectId: string) => ['transmittals', projectId]
const correspondenceKey = (projectId: string) => ['correspondence', projectId]

export const useDocControlDashboard = (projectId: string) =>
  useQuery<DocControlDashboardData>({
    queryKey: docDashboardKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/doc-control/dashboard`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useRfis = (projectId: string) =>
  useQuery<{ rows: RfiRecord[] }>({
    queryKey: rfiKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/rfi`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { subject: string }) =>
      apiClient
        .post(`/projects/${projectId}/rfi`, payload)
        .then((response) => response.data.data as RfiRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rfiKey(projectId) })
      qc.invalidateQueries({ queryKey: docDashboardKey(projectId) })
    },
  })
}

export const useSubmittals = (projectId: string) =>
  useQuery<{ rows: SubmittalRecord[] }>({
    queryKey: submittalKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/submittals`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateSubmittal = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { title: string }) =>
      apiClient
        .post(`/projects/${projectId}/submittals`, payload)
        .then((response) => response.data.data as SubmittalRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: submittalKey(projectId) })
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
    mutationFn: (payload: { drawingNumber: string; title: string }) =>
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
