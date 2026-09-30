import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** Budget by cost code (OCTA-FIN-COSTCODE-019). */

export const BUDGET_COST_TYPES = [
  'labour',
  'material',
  'equipment',
  'subcontract',
  'indirect',
  'overhead',
  'contingency',
  'other',
] as const
export type BudgetCostType = (typeof BUDGET_COST_TYPES)[number]

export const COST_TYPE_LABEL: Record<BudgetCostType, string> = {
  labour: 'Labour',
  material: 'Material',
  equipment: 'Equipment',
  subcontract: 'Subcontract',
  indirect: 'Indirect',
  overhead: 'Overhead',
  contingency: 'Contingency',
  other: 'Other',
}

export interface BudgetCostCodeRef {
  id: string
  code: string
  name: string
  category: string
  parentId: string | null
}

export interface ProjectCostCode {
  id: string
  costCodeId: string
  code: string | null
  name: string | null
  category: string | null
  parentId: string | null
  status: 'active' | 'archived'
  sortOrder: number
}

export interface BudgetAllocation {
  id: string
  activityId: string
  activity: { id: string; name: string; code: string | null } | null
  weight: number
  amount: number
  source: 'manual' | 'boq' | 'even'
}

export interface BudgetLineChange {
  id: string
  kind: 'change_order' | 'revision' | 'transfer_in' | 'transfer_out'
  amount: number
  changeOrderId: string | null
  counterpartLineId: string | null
  note: string | null
  createdAt: string | null
}

export interface BudgetLine {
  id: string
  projectId: string
  costCodeId: string
  costCode: BudgetCostCodeRef | null
  costType: BudgetCostType
  description: string | null
  status: 'active' | 'archived'
  sortOrder: number
  originalBudget: number
  approvedChanges: number
  revisions: number
  revisedBudget: number
  committed: number
  actual: number
  forecast: number
  forecastIsManual: boolean
  /** Source / derived / projection per figure, and from what (PC-7a). */
  truth?: {
    originalBudget: string
    revised: string
    committed: string
    actual: string
    forecast: string
    derivedFrom: Record<string, string>
  }
  variance: number
  allocatedWeight: number
  allocatedAmount: number
  unallocatedAmount: number
  allocations: BudgetAllocation[]
  changes: BudgetLineChange[]
  createdAt: string | null
  updatedAt: string | null
}

export interface BudgetTotals {
  originalBudget: number
  approvedChanges: number
  revisions: number
  revisedBudget: number
  committed: number
  actual: number
  forecast: number
  variance: number
  allocatedAmount: number
  unallocatedAmount: number
}

export interface BudgetLinesResponse {
  items: BudgetLine[]
  summary: {
    totals: BudgetTotals
    byType: Array<{
      costType: BudgetCostType
      originalBudget: number
      revisedBudget: number
      committed: number
      actual: number
      forecast: number
      variance: number
    }>
    lines: number
    underAllocated: number
  }
}

export interface BudgetLineInput {
  costCodeId?: string
  costType?: BudgetCostType
  description?: string | null
  originalBudget?: number | null
  committed?: number | null
  actual?: number | null
  forecast?: number | null
  sortOrder?: number
  status?: 'active' | 'archived'
}

export interface BudgetReconciliation {
  generatedAt: string
  balanced: boolean
  totals: {
    activityBudget: number
    budgetLines: number
    allocatedToActivities: number
    unallocatedLines: number
    difference: number
  }
  // Each activity's approved BOQ allocation (boqBudget), and the budget and
  // difference built from it, with the lists read off them, are omitted by
  // the server for a member who may not read the BOQ — cost readers included
  // (owner decision E1) — who is told so (activityBudgetsWithheld, reason).
  activities: Array<{
    activityId: string
    name: string
    code: string | null
    boqBudget?: number
    approvedChanges: number
    activityBudget?: number
    budgetFromLines: number
    difference?: number
  }>
  mismatches?: Array<{ activityId: string; name: string; difference: number }>
  activityBudgetsWithheld?: true
  activityBudgetsReason?: string
  underAllocatedLines: Array<{
    id: string
    code: string | null
    costType: BudgetCostType
    revisedBudget: number
    allocatedWeight: number
    unallocatedAmount: number
  }>
  activitiesWithoutLines?: Array<{
    activityId: string
    name: string
    code: string | null
    activityBudget: number
  }>
}

export interface BudgetSnapshot {
  id: string
  projectId: string
  reportingPeriodId: string | null
  reportingPeriod: {
    id: string
    code: string
    label: string | null
    cutoffDate: string | null
    status: string
  } | null
  label: string
  takenBy: string | null
  takenAt: string | null
  totals: Partial<BudgetTotals> & { lines?: number }
  reconciliation: Partial<BudgetReconciliation> & { note?: string }
  lineCount?: number
  lines?: BudgetLine[]
}

export interface AllocationSuggestion {
  lineId: string
  // Omitted, with no items, when the suggestion (read off the BOQ
  // allocations) is withheld from this member (owner decision E1).
  basis?: 'boq' | 'even'
  withheld?: true
  reason?: string
  items: Array<{
    activityId: string
    activity: { id: string; name: string; code: string | null } | null
    basisAmount: number
    weight: number
    source: string
  }>
}

const budgetKey = (projectId: string) => ['budget', projectId] as const

const invalidateBudget = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: budgetKey(projectId) })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
  qc.invalidateQueries({ queryKey: ['cost-summary', projectId] })
}

const base = (projectId: string) => `/projects/${projectId}/budget`

export const useProjectCostCodes = (projectId: string) =>
  useQuery<{
    items: ProjectCostCode[]
    available: Array<BudgetCostCodeRef & { selected: boolean }>
  }>({
    queryKey: [...budgetKey(projectId), 'cost-codes'],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/cost-codes`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useSelectProjectCostCodes = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      costCodeIds?: string[]
      removeCostCodeIds?: string[]
      importAll?: boolean
    }) =>
      apiClient
        .put(`${base(projectId)}/cost-codes`, payload)
        .then((response) => response.data.data),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useBudgetLines = (
  projectId: string,
  query: {
    includeArchived?: boolean
    costType?: BudgetCostType | 'all'
    search?: string
  } = {}
) =>
  useQuery<BudgetLinesResponse>({
    queryKey: [...budgetKey(projectId), 'lines', query],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/lines`, {
          params: Object.fromEntries(
            Object.entries(query).filter(
              ([, value]) =>
                value !== undefined && value !== '' && value !== 'all'
            )
          ),
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateBudgetLine = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: BudgetLineInput & { costCodeId: string }) =>
      apiClient
        .post(`${base(projectId)}/lines`, payload)
        .then((response) => response.data.data as BudgetLine),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useUpdateBudgetLine = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      lineId,
      payload,
    }: {
      lineId: string
      payload: BudgetLineInput
    }) =>
      apiClient
        .patch(`${base(projectId)}/lines/${lineId}`, payload)
        .then((response) => response.data.data as BudgetLine),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useArchiveBudgetLine = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lineId: string) =>
      apiClient
        .delete(`${base(projectId)}/lines/${lineId}`)
        .then((response) => response.data.data as BudgetLine),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useImportBudgetLines = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      rows: Array<{
        code: string
        name?: string | null
        costType?: BudgetCostType
        originalBudget?: number
        description?: string | null
      }>
    ) =>
      apiClient
        .post(`${base(projectId)}/lines/import`, { rows })
        .then(
          (response) =>
            response.data.data as {
              created: number
              updated: number
              missingCodes: string[]
              // Existing lines whose original budget is locked (PC-7a): their
              // description was written, their original kept.
              lockedLines?: Array<{
                code: string
                costType: string
                existing: number
                proposed: number
              }>
            }
        ),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useSetBudgetLineAllocations = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      lineId,
      allocations,
    }: {
      lineId: string
      allocations: Array<{
        activityId: string
        weight: number
        source?: 'manual' | 'boq' | 'even'
      }>
    }) =>
      apiClient
        .put(`${base(projectId)}/lines/${lineId}/allocations`, { allocations })
        .then((response) => response.data.data as BudgetLine),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useSuggestBudgetLineAllocations = (projectId: string) =>
  useMutation({
    mutationFn: (lineId: string) =>
      apiClient
        .get(`${base(projectId)}/lines/${lineId}/allocations/suggest`)
        .then((response) => response.data.data as AllocationSuggestion),
  })

export const useTransferBudget = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      fromLineId: string
      toLineId: string
      amount: number
      note?: string | null
    }) =>
      apiClient
        .post(`${base(projectId)}/transfers`, payload)
        .then((response) => response.data.data as BudgetLinesResponse),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useAddBudgetRevision = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      lineId,
      amount,
      note,
    }: {
      lineId: string
      amount: number
      note: string
    }) =>
      apiClient
        .post(`${base(projectId)}/lines/${lineId}/revisions`, { amount, note })
        .then((response) => response.data.data as BudgetLine),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useBudgetReconciliation = (projectId: string) =>
  useQuery<BudgetReconciliation>({
    queryKey: [...budgetKey(projectId), 'reconciliation'],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/reconciliation`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useBudgetSnapshots = (projectId: string) =>
  useQuery<{ items: BudgetSnapshot[] }>({
    queryKey: [...budgetKey(projectId), 'snapshots'],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/snapshots`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useBudgetSnapshot = (
  projectId: string,
  snapshotId: string | null
) =>
  useQuery<BudgetSnapshot>({
    queryKey: [...budgetKey(projectId), 'snapshots', snapshotId ?? ''],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/snapshots/${snapshotId}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId && snapshotId),
  })

export const useTakeBudgetSnapshot = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      label?: string | null
      reportingPeriodId?: string | null
    }) =>
      apiClient
        .post(`${base(projectId)}/snapshots`, payload)
        .then((response) => response.data.data as BudgetSnapshot),
    onSuccess: () => invalidateBudget(qc, projectId),
  })
}

export const useReportingPeriodOptions = (projectId: string) =>
  useQuery<{
    periods?: Array<{
      id: string
      code: string
      label?: string | null
      status: string
      cutoffDate?: string | null
    }>
  }>({
    queryKey: ['ev-report-periods', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/reports/periods`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })
