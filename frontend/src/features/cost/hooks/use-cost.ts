import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface CostRecord {
  id: string
  activityId: string
  projectId: string
  labour: number
  material: number
  equipment: number
  subcontract: number
  indirect: number
  overhead: number
  contingency: number
  budget: number
  committed: number
  actual: number
  forecast: number
  updatedAt: string
  activity?: {
    id: string
    name: string
    wbsCode: string | null
    category: string | null
    sortOrder: number
  }
}

export interface CostSummary {
  records: CostRecord[]
  byPhase: Array<{
    phase: string
    budget: number
    committed: number
    actual: number
    forecast: number
    variance: number
    variancePct: number
  }>
  totals: {
    budget: number
    committed: number
    actual: number
    forecast: number
  }
  eac: {
    optimistic: number
    mostLikely: number
    pessimistic: number
  }
}

export interface BurnRateSummary {
  budgetRate: number
  data: Array<{ date: string; actual: number; budget: number }>
}

const costKey = (projectId: string) => ['cost-records', projectId]
const costSummaryKey = (projectId: string) => ['cost-summary', projectId]
const burnRateKey = (projectId: string) => ['burn-rate', projectId]

export const useCostRecords = (projectId: string) =>
  useQuery<CostRecord[]>({
    queryKey: costKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/cost`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCostSummary = (projectId: string) =>
  useQuery<CostSummary>({
    queryKey: costSummaryKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/cost/summary`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useBurnRate = (projectId: string) =>
  useQuery<BurnRateSummary>({
    queryKey: burnRateKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/cost/burn-rate`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useUpsertCostRecord = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      activityId,
      payload,
    }: {
      activityId: string
      payload: Partial<CostRecord>
    }) =>
      apiClient
        .post(`/projects/${projectId}/cost/activity/${activityId}`, payload)
        .then((response) => response.data.data as CostRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: costKey(projectId) })
      qc.invalidateQueries({ queryKey: costSummaryKey(projectId) })
    },
  })
}

export const useUpdateCostRecord = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      costRecordId,
      payload,
    }: {
      costRecordId: string
      payload: Partial<CostRecord>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/cost/${costRecordId}`, payload)
        .then((response) => response.data.data as CostRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: costKey(projectId) })
      qc.invalidateQueries({ queryKey: costSummaryKey(projectId) })
    },
  })
}

export const useAddBurnRateEntry = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (payload: {
      date?: string
      amount: number
      category?: string
      note?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/cost/burn-rate`, payload)
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: burnRateKey(projectId) })
    },
  })
}
