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
  actualThroughDate: string | null
  forecast: number
  /** committed is the executed commitments' figure on this activity — the API refuses a typed one (CX21-493). */
  committedDerived?: boolean
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

export interface CursorPagination {
  limit: number
  nextCursor: string | null
}

export interface CostRecordListQuery {
  cursor?: string | null
  limit?: number
  activityId?: string
  category?: string
  search?: string
  sortBy?:
    | 'activity'
    | 'phase'
    | 'updated'
    | 'labour'
    | 'material'
    | 'equipment'
    | 'subcontract'
    | 'committed'
    | 'actual'
    | 'forecast'
  sortDir?: 'asc' | 'desc'
}

export interface CostRecordPage {
  rows: CostRecord[]
  pagination?: CursorPagination
}

const costKey = (projectId: string) => ['cost-records', projectId]
const costListKey = (projectId: string, query: CostRecordListQuery) => [
  ...costKey(projectId),
  query,
]
const costSummaryKey = (projectId: string) => ['cost-summary', projectId]
const burnRateKey = (projectId: string) => ['burn-rate', projectId]

const cleanListParams = (query: CostRecordListQuery) =>
  Object.fromEntries(
    Object.entries(query).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false
      return value !== 'all'
    })
  )

export const useCostRecords = (
  projectId: string,
  query: CostRecordListQuery = {}
) =>
  useQuery<CostRecordPage>({
    queryKey: costListKey(projectId, query),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/cost`, { params: cleanListParams(query) })
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
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      qc.invalidateQueries({ queryKey: ['ev-report', projectId] })
      qc.invalidateQueries({ queryKey: ['health', projectId] })
      qc.invalidateQueries({ queryKey: ['workspace-dashboard'] })
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
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      qc.invalidateQueries({ queryKey: ['ev-report', projectId] })
      qc.invalidateQueries({ queryKey: ['health', projectId] })
      qc.invalidateQueries({ queryKey: ['workspace-dashboard'] })
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
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}
