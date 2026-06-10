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
    dueAlerts: number
    overdue: number
  }
}

export interface NcrRecord extends WorkflowRecordMeta {
  id: string
  ref: string
  severity: 'major' | 'minor'
  status: 'open' | 'closed'
  description: string | null
  disposition?: string | null
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
  status: 'open' | 'investigating' | 'closed'
  lostDays: number
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

export const useQualityDashboard = (projectId: string) =>
  useQuery<QualityDashboardData>({
    queryKey: qDashKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/quality/dashboard`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
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
    mutationFn: (payload: { title: string; owner?: string; dueDate?: string }) =>
      apiClient
        .post(`/projects/${projectId}/itp`, payload)
        .then((response) => response.data.data as ItpRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: itpKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
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
    mutationFn: (payload: { testType: string; owner?: string; dueDate?: string }) =>
      apiClient
        .post(`/projects/${projectId}/material-tests`, payload)
        .then((response) => response.data.data as MaterialTest),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: materialTestKey(projectId) })
      qc.invalidateQueries({ queryKey: qDashKey(projectId) })
    },
  })
}
