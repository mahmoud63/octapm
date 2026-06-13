import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface RiskRecord {
  id: string
  projectId: string
  ref: string
  description: string
  probability: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  mitigation: string | null
  responsePlan: string | null
  residualProbability: 'low' | 'medium' | 'high'
  residualImpact: 'low' | 'medium' | 'high'
  residualSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  residualDescription: string | null
  phase: string | null
  owner: string | null
  dueDate: string | null
  escalationLevel: 'none' | 'watch' | 'escalated'
  escalationNotes: string | null
  status: 'open' | 'monitoring' | 'submitted' | 'closed' | 'archived'
  closeoutComment: string | null
  closeoutSubmittedAt: string | null
  closedAt: string | null
  rejectionReason: string | null
  archivedAt?: string | null
  archivedBy?: string | null
  activityLinks: RiskActivityLink[]
  activityIds: string[]
  approvalHistory?: Array<Record<string, unknown>>
  createdAt: string
  updatedAt: string
}

export interface RiskActivityLink {
  id?: string
  activityId: string
  relationType: string
  scheduleImpactDays: number
  costImpact: number
  notes?: string | null
  activity?: {
    id: string
    name: string
    activityCode?: string | null
    p6ActivityId?: string | null
    wbsCode?: string | null
    isCritical?: boolean
    totalFloat?: number | null
  } | null
}

export interface RiskPayload {
  description: string
  probability: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  mitigation?: string
  responsePlan?: string
  residualProbability?: 'low' | 'medium' | 'high'
  residualImpact?: 'low' | 'medium' | 'high'
  residualSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  residualDescription?: string
  phase?: string
  owner?: string
  dueDate?: string
  escalationLevel?: 'none' | 'watch' | 'escalated'
  escalationNotes?: string
  status?: 'open' | 'monitoring'
  activityLinks?: Array<{
    activityId: string
    relationType?: string
    scheduleImpactDays?: number
    costImpact?: number
    notes?: string | null
  }>
}

export interface RiskCloseoutPayload {
  dueDate?: string
  responsePlan?: string
  closeoutComment?: string
  comment?: string
  reason?: string
}

const riskKey = (projectId: string) => ['risks', projectId]

const invalidateRiskViews = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: riskKey(projectId) })
  qc.invalidateQueries({ queryKey: ['schedule', projectId] })
  qc.invalidateQueries({ queryKey: ['activities', projectId] })
  qc.invalidateQueries({ queryKey: ['workspace-dashboard'] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useRisks = (projectId: string) =>
  useQuery<RiskRecord[]>({
    queryKey: riskKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/risks`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateRisk = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (payload: RiskPayload) =>
      apiClient
        .post(`/projects/${projectId}/risks`, payload)
        .then((response) => response.data.data as RiskRecord),
    onSuccess: () => {
      invalidateRiskViews(qc, projectId)
    },
  })
}

export const useUpdateRisk = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      riskId,
      payload,
    }: {
      riskId: string
      payload: Partial<RiskPayload>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/risks/${riskId}`, payload)
        .then((response) => response.data.data as RiskRecord),
    onSuccess: () => {
      invalidateRiskViews(qc, projectId)
    },
  })
}

export const useSubmitRiskCloseout = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      riskId,
      payload,
    }: {
      riskId: string
      payload: RiskCloseoutPayload
    }) =>
      apiClient
        .post(`/projects/${projectId}/risks/${riskId}/submit`, payload)
        .then((response) => response.data.data as RiskRecord),
    onSuccess: () => {
      invalidateRiskViews(qc, projectId)
    },
  })
}

export const useApproveRiskCloseout = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ riskId, comment }: { riskId: string; comment?: string }) =>
      apiClient
        .post(`/projects/${projectId}/risks/${riskId}/approve`, { comment })
        .then((response) => response.data.data as RiskRecord),
    onSuccess: () => {
      invalidateRiskViews(qc, projectId)
    },
  })
}

export const useRejectRiskCloseout = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ riskId, reason }: { riskId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/risks/${riskId}/reject`, { reason })
        .then((response) => response.data.data as RiskRecord),
    onSuccess: () => {
      invalidateRiskViews(qc, projectId)
    },
  })
}

export const useReopenRisk = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ riskId, reason }: { riskId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/risks/${riskId}/reopen`, { reason })
        .then((response) => response.data.data as RiskRecord),
    onSuccess: () => {
      invalidateRiskViews(qc, projectId)
    },
  })
}

export const useArchiveRisk = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (riskId: string) =>
      apiClient
        .delete(`/projects/${projectId}/risks/${riskId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      invalidateRiskViews(qc, projectId)
    },
  })
}
