import { formatDate } from '../lib/detail-format'
import type {
  ExceptionSeverity,
  ExceptionStatus,
  ProjectException,
  SeverityCounts,
} from './api'

/**
 * Words for the exception surfaces. Everything here labels what the server
 * sent; nothing derives a figure from `measured` / `limit`.
 */

/** Kinds of change intelligence §1 (overruns) and §7 (data quality), in words. */
export const EXCEPTION_KIND_LABEL: Record<string, string> = {
  quantity_over_allocation: 'Installed over allocation',
  quantity_over_boq: 'Installed over BOQ quantity',
  certified_over_installed: 'Certified over installed',
  certified_over_earned: 'Certified over earned',
  committed_over_budget: 'Committed over budget',
  actual_over_committed: 'Actual over committed',
  forecast_over_revised: 'Forecast over revised budget',
  allocation_over_capacity: 'Allocations over item quantity',
  schedule_slip_on_mapped_item: 'Schedule slip on a mapped item',
  budget_truths_disagree: 'Budget figures disagree',
  forecast_without_provenance: 'Forecast without provenance',
  activity_budget_mismatch: 'Activity budget ≠ allocations',
  unit_unresolved: 'Unit not in the master',
  unit_mismatch: 'Units differ',
  structure_missing: 'Structure missing',
  progress_stale: 'Progress stale',
  period_not_locked: 'Period not locked',
  ev_basis_divergence: 'Earned value bases differ',
  committed_definition_mixed: 'Committed definitions mixed',
  equipment_cost_unposted: 'Equipment cost not posted',
  orphan_change_link: 'Change link names a missing record',
  readiness_override_active: 'Readiness override active',
}

export const kindLabel = (kind: string) =>
  EXCEPTION_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ')

export const SEVERITY_ORDER: ExceptionSeverity[] = ['critical', 'warning', 'info']

export const SEVERITY_LABEL: Record<ExceptionSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
}

export const STATUS_LABEL: Record<ExceptionStatus, string> = {
  open: 'Open',
  in_change: 'In change',
  snoozed: 'Snoozed',
  dismissed: 'Dismissed',
  resolved: 'Resolved',
}

/** "3 critical · 1 warning · 0 info" from the server's counts; a severity it did not send is left out. */
export const severityCountsText = (counts: SeverityCounts) =>
  SEVERITY_ORDER.filter((severity) => typeof counts[severity] === 'number')
    .map((severity) => `${counts[severity]!.toLocaleString()} ${severity}`)
    .join(' · ')

export const detectedText = (exception: ProjectException) =>
  `detected ${formatDate(exception.detectedAt)} · last seen ${formatDate(exception.lastSeenAt)}`

/** Group keys the server labelled (WBS, location, cost code); ids without a label are not drawn. */
export const groupLabels = (group: ProjectException['group']) => {
  if (!group || typeof group !== 'object') return [] as string[]
  const labels: string[] = []
  for (const [key, value] of Object.entries(group)) {
    if (value && typeof value === 'object' && typeof (value as { label?: unknown }).label === 'string') {
      labels.push((value as { label: string }).label)
    } else if (typeof value === 'string' && !key.endsWith('Id')) {
      labels.push(value)
    }
  }
  return labels
}
