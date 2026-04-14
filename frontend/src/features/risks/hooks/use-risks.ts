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
  phase: string | null
  owner: string | null
  status: 'open' | 'closed' | 'monitoring'
  createdAt: string
  updatedAt: string
}

export interface RiskPayload {
  description: string
  probability: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  mitigation?: string
  phase?: string
  owner?: string
  status?: 'open' | 'closed' | 'monitoring'
}

const riskKey = (projectId: string) => ['risks', projectId]

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
      qc.invalidateQueries({ queryKey: riskKey(projectId) })
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
      qc.invalidateQueries({ queryKey: riskKey(projectId) })
    },
  })
}

export const useDeleteRisk = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (riskId: string) =>
      apiClient
        .delete(`/projects/${projectId}/risks/${riskId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: riskKey(projectId) })
    },
  })
}
