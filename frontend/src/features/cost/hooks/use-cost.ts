import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type CostForecastSource = 'entered' | 'default'

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
  // The activity's approved BOQ allocation, and the budget first written on
  // the record: omitted by the server for a member who may not read the BOQ,
  // cost readers included (owner decision E1, 2026-09-28).
  budget?: number
  generatedBudget?: number
  committed: number
  actual: number
  actualThroughDate: string | null
  // The stored forecast and where it came from (owner decision R5-2): entered
  // by a caller, the server's initial default (the larger of the budget and
  // the actual cost as they stood when it was set), or null — not recorded, a row older than the
  // column. The server alone sets the source. A DEFAULT forecast is built
  // from the record's budget, so the server omits it (forecastWithheld, with
  // its reason) for a member who may not read the BOQ.
  forecast?: number
  forecastSource?: CostForecastSource | null
  forecastBasis?: string
  forecastWithheld?: boolean
  forecastWithheldReason?: string
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

// The figures the summary adds up from the records' budgets (each activity's
// approved BOQ allocation) — per category, in total, and the forecast and EAC
// that fall back to them — are omitted by the server for a member who may
// not read the BOQ, cost readers included (owner decision E1), and the
// answer says so (activityBudgetsWithheld, activityBudgetsReason).
export interface CostSummary {
  records: CostRecord[]
  byPhase: Array<{
    phase: string
    budget?: number
    committed: number
    actual: number
    forecast?: number
    variance?: number
    variancePct?: number
  }>
  totals: {
    budget?: number
    committed: number
    actual: number
    forecast?: number
  }
  eac: {
    optimistic?: number
    mostLikely?: number
    pessimistic?: number
    /**
     * The cost records' projected final cost: actual to date + cost to
     * complete (Phase 22A). Not the earned-value EAC (revised budget ÷ CPI).
     */
    basis?: 'estimate_at_completion'
    actual?: number
    toComplete?: number
  }
  /** The budget as the budget register states it — one vocabulary (Phase 22A). */
  budget?: {
    originalBudget: number | null
    approvedChanges: number | null
    revisions: number | null
    revisedBudget: number | null
    allocatedToActivities?: number
    source: 'budget_register' | null
    /** "Budget" — the register's budget, not the EV basis nor the waterfall (PC-7a). */
    label?: string
  }
  /**
   * Source / derived / projection, and from what (PC-7a three truths).
   * Labels only, the same for every project and reader; present even where
   * the figure it describes is withheld.
   */
  truth?: {
    budget?: { truth: string; label: string; derivedFrom: string }
    allocatedToActivities?: { truth: string; label: string; derivedFrom: string }
    totals?: {
      budget: string
      committed: string
      actual: string
      forecast: string
      /** "Projected final cost (cost records)" — never "EAC" (R5-2). */
      labels?: { forecast?: string }
      derivedFrom: Record<string, string>
    }
    records?: {
      forecast: string
      derivedFrom: Record<string, string>
      /** The basis text of each forecast source (R5-2). */
      basis?: { entered: string; default: string; notRecorded: string }
    }
    eac?: { truth: string; label?: string; derivedFrom: string }
  }
  /**
   * How many records' forecasts were entered, are the initial default, or
   * were not recorded (R5-2) — the forecast total mixes them and says so.
   */
  forecastSources?: {
    entered: number
    default: number
    notRecorded: number
    total: number
  }
  activityBudgetsWithheld?: boolean
  activityBudgetsReason?: string
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
  /**
   * Present when the list was asked in the order of a figure the server
   * withholds from this member on some rows (sortBy=forecast without BOQ
   * access): those rows are not ordered by it, and the server says why (R5-2).
   */
  sortWithheld?: { sortBy: string; reason: string }
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
