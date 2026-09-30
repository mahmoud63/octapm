import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { EvCutoff } from '@/lib/ev-cutoff'
import {
  EAC_NO_COST_PERFORMANCE,
  eacBasisLabel,
  type EacBasis,
} from '@/lib/eac-basis'

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
  // Whole only for a reader of the BOQ (§12): the budget is the activity's
  // approved allocation, and the projection, overrun, basis and level are
  // built from it. A cost reader without BOQ read keeps only `actual` and
  // `committed` (the cost ledger's), with `withheld` and the server's reason
  // (owner decision E1, 2026-09-28); anyone else gets `withheld` and the
  // reason alone.
  cost: {
    budget?: number
    actual?: number
    committed?: number
    projected?: number | null
    basis?: string | null
    overrun?: number
    overrunPct?: number
    level?: ForecastLevel
    reasons?: string[]
    withheld?: true
    reason?: string
  }
}

export interface ForecastBudgetLine {
  id: string
  costCode: string | null
  name: string
  costType: string | null
  revised?: number
  committed?: number
  actual?: number
  forecast?: number
  overrun?: number
  overrunPct?: number | null
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
  /** The EV cutoff SPI, CPI and EAC were measured through (lib/ev-cutoff). */
  earnedValueCutoff?: EvCutoff | null
  // The project's money only for a BOQ or cost reader (§12); what each
  // activity is given, as on ForecastActivity above.
  cost: {
    budget?: number
    /** The revised BAC the EAC was computed from (the EV report's). */
    bac?: number | null
    /** The official EV report's EAC: revised BAC / CPI, else the revised BAC. */
    eac?: number | null
    /** Which rule gave the EAC; with the EAC, only for a BOQ or cost reader. */
    eacBasis?: EacBasis | null
    bottomUp?: number
    projected?: number
    overrun?: number
    overrunPct?: number | null
    actual?: number
    // The activities over budget, and their tally by level, only for a BOQ
    // reader: an activity can be over only a budget it has, so the list is
    // read off the mapping. A cost reader without BOQ read gets
    // `activityCostWithheld` and why (E1); anyone else `withheld` and why.
    counts: { atRisk?: Record<ForecastLevel, number>; lines: number }
    topRisks?: ForecastActivity[]
    budgetLines: ForecastBudgetLine[]
    withheld?: true
    reason?: string
    activityCostWithheld?: true
    activityCostReason?: string
    /**
     * Source / derived / projection per figure, and from what (PC-7a).
     * Labels only; the same for every reader, present where figures are withheld.
     */
    truth?: {
      budget: string
      bac: string
      actual: string
      eac: string
      bottomUp: string
      projected: string
      overrun: string
      labels?: { budget?: string; bac?: string }
      derivedFrom?: Record<string, string>
    }
  } | null
  summary: { scheduleLevel: ForecastLevel; costLevel: ForecastLevel } | null
  dataQuality: string[]
  activities: ForecastActivity[]
}

// The basis and its words are shared with the EV tab (lib/eac-basis).
export type { EacBasis }
export { EAC_NO_COST_PERFORMANCE }
export const COST_FIGURES_WITHHELD = 'Cost figures are not available to you'

export type EacStatement = {
  /** The EAC, or null when there is none to show (withheld, or no EV report). */
  value: number | null
  /** What the figure is, in words: its rule, or why there is none. */
  label: string
  withheld: boolean
  /** EAC above the revised BAC it was computed from (same basis); null when unknown. */
  over: boolean | null
}

/**
 * The business-rule estimate at completion as every screen states it (owner
 * decision D2): the server's figure (the official EV report's EAC, which the
 * forecast carries), its rule, and whether it is above the revised BAC it was
 * computed from. Nothing is computed here but that comparison.
 */
export function eacStatement(
  forecast: ProjectForecast | null | undefined
): EacStatement {
  const cost = forecast?.cost
  if (!cost) {
    return {
      value: null,
      label: forecast?.reason ?? 'no forecast yet',
      withheld: false,
      over: null,
    }
  }
  if (cost.budget === undefined) {
    return {
      value: null,
      label: COST_FIGURES_WITHHELD,
      withheld: true,
      over: null,
    }
  }
  if (cost.eac === null || cost.eac === undefined || !cost.eacBasis) {
    return {
      value: null,
      label: 'no earned-value report yet',
      withheld: false,
      over: null,
    }
  }
  if (cost.eacBasis === 'no_budget') {
    return {
      value: null,
      label: 'no approved budget yet',
      withheld: false,
      over: null,
    }
  }
  const over =
    cost.bac === null || cost.bac === undefined
      ? null
      : cost.eac > cost.bac + 0.005
  return {
    value: cost.eac,
    label: eacBasisLabel(cost.eacBasis) ?? EAC_NO_COST_PERFORMANCE,
    withheld: false,
    over,
  }
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
