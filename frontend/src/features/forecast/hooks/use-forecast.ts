import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Schedule delay and cost overrun prediction (OCTA-AI-PREDICT-031). The
 * forecast is computed from the project's own records; the narrative and
 * its draft actions come from the model and are confirmed by the person.
 */

export type ForecastLevel = 'high' | 'medium' | 'low'

export interface ForecastBlocker {
  type: 'rfi' | 'submittal' | 'long_lead'
  id: string
  ref: string | null
  title: string
  status: string | null
  due: string | null
  overdue: boolean
}

export interface ForecastActivity {
  id: string
  name: string
  code: string | null
  isCritical: boolean
  isMilestone: boolean
  status: string
  pct: number
  expectedPct: number | null
  gap: number
  velocity: number | null
  lastProgressAt: string | null
  plannedStart: string | null
  plannedFinish: string | null
  projectedFinish: string | null
  basis: 'complete' | 'planned' | 'velocity' | 'pace' | 'overdue' | 'late_start'
  slipDays: number
  impactDays: number
  float: number | null
  floatBreached: boolean
  stalledDays: number
  blockers: ForecastBlocker[]
  score: number
  level: ForecastLevel
  reasons: string[]
  cost: {
    budget: number
    actual: number
    committed: number
    projected: number | null
    basis: string | null
    overrun: number
    overrunPct: number
    level: ForecastLevel
    reasons: string[]
  }
}

export interface ForecastBudgetLine {
  id: string
  costCode: string | null
  name: string
  costType: string | null
  revised: number
  committed: number
  actual: number
  forecast: number
  overrun: number
  overrunPct: number | null
  level: ForecastLevel
}

export interface ProjectForecast {
  available: boolean
  reason?: string | null
  asOf: string
  schedule: {
    plannedFinish: string | null
    projectedFinish: string | null
    slipDays: number
    basis: 'earned_value' | 'activities' | 'planned'
    evBasedFinish: string | null
    activityBasedFinish: string | null
    spi: number | null
    cpi: number | null
    criticalDriver: { id: string; name: string; slipDays: number } | null
    counts: {
      activities: number
      open: number
      complete: number
      critical: number
      atRisk: Record<ForecastLevel, number>
    }
    topRisks: ForecastActivity[]
  } | null
  cost: {
    budget: number
    eac: number | null
    bottomUp: number
    projected: number
    overrun: number
    overrunPct: number | null
    actual: number
    counts: { atRisk: Record<ForecastLevel, number>; lines: number }
    topRisks: ForecastActivity[]
    budgetLines: ForecastBudgetLine[]
  } | null
  summary: { scheduleLevel: ForecastLevel; costLevel: ForecastLevel } | null
  dataQuality: string[]
  activities: ForecastActivity[]
}

export interface ForecastAction {
  type: 'create_risk' | 'create_task' | 'open'
  label: string
  activityId: string | null
  activityName: string | null
  title?: string | null
  description?: string | null
  probability?: ForecastLevel | null
  impact?: ForecastLevel | null
  mitigation?: string | null
}

export interface ForecastNarrative {
  headline: string
  schedule: string
  cost: string
  watch: string[]
  actions: ForecastAction[]
}

export interface ForecastExplanation {
  degraded: boolean
  reason?: string | null
  forecast: ProjectForecast
  narrative: ForecastNarrative
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

const base = (projectId: string) => `/projects/${projectId}/forecast`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const forecastKey = (projectId: string) =>
  ['forecast', projectId] as const

export const useForecast = (projectId: string, enabled = true) =>
  useQuery<ProjectForecast>({
    queryKey: forecastKey(projectId),
    queryFn: () => data<ProjectForecast>(apiClient.get(base(projectId))),
    staleTime: 60_000,
    enabled: Boolean(projectId) && enabled,
  })

export const useExplainForecast = (projectId: string) =>
  useMutation({
    mutationFn: () =>
      data<ForecastExplanation>(
        apiClient.post(`${base(projectId)}/explain`, {}, { timeout: 120_000 })
      ),
  })

export const useRunForecastAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: ForecastAction) =>
      data<{
        type: string
        record: { id: string; ref: string | null; status: string | null }
        url: string
      }>(apiClient.post(`${base(projectId)}/actions`, { action })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule', projectId] })
      qc.invalidateQueries({ queryKey: ['risks', projectId] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: forecastKey(projectId) })
    },
  })
}
