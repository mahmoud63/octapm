import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { WorkflowRecordMeta } from '@/features/workflows/components/workflow-record-list'

export interface QualityDashboardData {
  metrics: {
    qualityScore: number
    majorNcrs: number
    minorNcrs: number
    failedItps: number
    openDefects: number
    testsPassed: number
    testsFailed: number
    safetyIncidents: number
    safetyOpen: number
    observationsOpen?: number
    safetyObservationsOpen?: number
    observationsByType?: Record<string, number>
    dueAlerts: number
    overdue: number
  }
}

export interface NcrRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  severity: 'major' | 'minor'
  status: 'open' | 'submitted' | 'closed'
  description: string | null
  disposition?: string | null
  responsible?: string | null
  closureComment?: string | null
  dueDate?: string | null
}

export interface ItpRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  title: string
  status: 'pending' | 'passed' | 'failed' | 'waived'
  pointType?: 'hold' | 'witness' | 'review'
  dueDate?: string | null
}

export interface DefectRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  title: string
  severity: 'minor' | 'major' | 'critical'
  status: 'open' | 'in_progress' | 'closed'
  dueDate?: string | null
}

export interface SafetyIncident extends WorkflowRecordMeta {
  id: string
  ref: string
  incidentType: 'near_miss' | 'first_aid' | 'lti' | 'fatality'
  title: string
  status: 'open' | 'investigating' | 'submitted' | 'closed'
  lostDays: number
  responsible?: string | null
  closureComment?: string | null
  dueDate?: string | null
}

export interface MaterialTest extends WorkflowRecordMeta {
  id: string
  ref: string
  testType: string
  result: 'pass' | 'fail' | 'pending'
  dueDate?: string | null
}

const qDashKey = (projectId: string) => ['quality-dashboard', projectId]
const ncrKey = (projectId: string) => ['ncr', projectId]
const itpKey = (projectId: string) => ['itp', projectId]
const defectKey = (projectId: string) => ['defects', projectId]
const safetyKey = (projectId: string) => ['safety', projectId]
const materialTestKey = (projectId: string) => ['material-tests', projectId]

type CloseoutPayload = {
  responsible: string
  assigneeUserId?: string | null
  dueDate: string
  closureComment: string
  attachmentRefs: Array<{
    fileName?: string
    fileUrl?: string
    storageKey?: string
    mimeType?: string
    description?: string
  }>
}

export type WorkflowAttachmentUpload = {
  documentId?: string
  key?: string
  storageKey?: string
  url?: string
  fileUrl?: string
  downloadUrl?: string
  filename?: string
  fileName?: string
  originalName?: string
  mimeType?: string
  size?: number
  sizeBytes?: number
}

const invalidateQuality = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: qDashKey(projectId) })
  qc.invalidateQueries({ queryKey: ['workspace-dashboard'] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useQualityDashboard = (projectId: string) =>
  useQuery<QualityDashboardData>({
    queryKey: qDashKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/quality/dashboard`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useUploadWorkflowAttachments = (projectId: string) =>
  useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData()
      files.forEach((file) => fd.append('files', file))
      return apiClient
        .post(`/projects/${projectId}/workflow/uploads`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((response) => response.data.data as WorkflowAttachmentUpload[])
    },
  })

export const useNcrs = (projectId: string) =>
  useQuery<{ rows: NcrRecord[] }>({
    queryKey: ncrKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/ncr`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateNcr = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      description?: string
      severity?: 'major' | 'minor'
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/ncr`, payload)
        .then((response) => response.data.data as NcrRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ncrKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useCloseNcr = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      ncrId,
      payload,
    }: {
      ncrId: string
      payload: CloseoutPayload
    }) =>
      apiClient
        .post(`/projects/${projectId}/ncr/${ncrId}/close`, payload)
        .then((response) => response.data.data as NcrRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ncrKey(projectId) })
      invalidateQuality(qc, projectId)
    },
  })
}

export const useApproveNcr = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ncrId, comment }: { ncrId: string; comment?: string }) =>
      apiClient
        .post(`/projects/${projectId}/ncr/${ncrId}/approve`, { comment })
        .then((response) => response.data.data as NcrRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ncrKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useRejectNcr = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ncrId, reason }: { ncrId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/ncr/${ncrId}/reject`, { reason })
        .then((response) => response.data.data as NcrRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ncrKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useReopenNcr = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ncrId, reason }: { ncrId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/ncr/${ncrId}/reopen`, { reason })
        .then((response) => response.data.data as NcrRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ncrKey(projectId) })
      invalidateQuality(qc, projectId)
    },
  })
}

export const useItps = (projectId: string) =>
  useQuery<{ rows: ItpRecord[] }>({
    queryKey: itpKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/itp`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateItp = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      title: string
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/itp`, payload)
        .then((response) => response.data.data as ItpRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: itpKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useDefects = (projectId: string) =>
  useQuery<{ rows: DefectRecord[] }>({
    queryKey: defectKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/defects`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateDefect = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      title: string
      severity?: 'minor' | 'major' | 'critical'
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/defects`, payload)
        .then((response) => response.data.data as DefectRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: defectKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useSafetyIncidents = (projectId: string) =>
  useQuery<{ rows: SafetyIncident[] }>({
    queryKey: safetyKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/safety`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateSafetyIncident = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      title: string
      incidentType: 'near_miss' | 'first_aid' | 'lti' | 'fatality'
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/safety`, payload)
        .then((response) => response.data.data as SafetyIncident),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: safetyKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useCloseSafetyIncident = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      incidentId,
      payload,
    }: {
      incidentId: string
      payload: CloseoutPayload
    }) =>
      apiClient
        .post(`/projects/${projectId}/safety/${incidentId}/close`, payload)
        .then((response) => response.data.data as SafetyIncident),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: safetyKey(projectId) })
      invalidateQuality(qc, projectId)
    },
  })
}

export const useApproveSafetyIncident = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      incidentId,
      comment,
    }: {
      incidentId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/safety/${incidentId}/approve`, {
          comment,
        })
        .then((response) => response.data.data as SafetyIncident),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: safetyKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useRejectSafetyIncident = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      incidentId,
      reason,
    }: {
      incidentId: string
      reason: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/safety/${incidentId}/reject`, { reason })
        .then((response) => response.data.data as SafetyIncident),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: safetyKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useReopenSafetyIncident = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      incidentId,
      reason,
    }: {
      incidentId: string
      reason: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/safety/${incidentId}/reopen`, {
          reason,
        })
        .then((response) => response.data.data as SafetyIncident),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: safetyKey(projectId) })
      invalidateQuality(qc, projectId)
    },
  })
}

export const useMaterialTests = (projectId: string) =>
  useQuery<{ rows: MaterialTest[] }>({
    queryKey: materialTestKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/material-tests`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateMaterialTest = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      testType: string
      owner?: string
      dueDate?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/material-tests`, payload)
        .then((response) => response.data.data as MaterialTest),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: materialTestKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}
