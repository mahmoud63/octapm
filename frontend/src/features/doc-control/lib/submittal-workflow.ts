import type {
  SubmittalResponseCode,
  SubmittalStepAssignee,
  SubmittalWorkflowStep,
} from '../hooks/use-doc-control'

export const RESPONSE_CODE_LABELS: Record<SubmittalResponseCode, string> = {
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise and resubmit',
  rejected: 'Rejected',
  custom: 'Custom',
}

export const APPROVE_CODES: SubmittalResponseCode[] = [
  'approved',
  'approved_as_noted',
  'custom',
]
export const REJECT_CODES: SubmittalResponseCode[] = [
  'revise_resubmit',
  'rejected',
  'custom',
]

export const SUBMITTAL_STATUS_LABEL: Record<string, string> = {
  pending: 'Not submitted',
  under_review: 'Under review',
  approved: 'Approved',
  resubmit: 'Returned – resubmit',
  rejected: 'Rejected',
  archived: 'Archived',
}

export const STEP_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  active: 'In review',
  approved: 'Approved',
  rejected: 'Returned',
  skipped: 'Skipped',
}

export const PACKAGE_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  submitted: 'Submitted',
  closed: 'Closed',
}

export const PARTY_ROLE_OPTIONS = [
  { id: 'owner', label: 'Owner' },
  { id: 'consultant', label: 'Consultant' },
  { id: 'contractor', label: 'Contractor' },
  { id: 'subcontractor', label: 'Subcontractor' },
]

export const PROJECT_ROLE_OPTIONS = [
  { id: 'pm', label: 'Project Manager' },
  { id: 'planning_eng', label: 'Planning Engineer' },
  { id: 'qs', label: 'Quantity Surveyor' },
  { id: 'cost_controller', label: 'Cost Controller' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'site_engineer', label: 'Site Engineer' },
  { id: 'finance', label: 'Finance' },
]

export const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

export const reviewDaysFor = (steps: SubmittalWorkflowStep[] = []) =>
  steps.reduce((sum, step) => sum + (Number(step.days) || 0), 0)

/** Mirrors the backend: need date (or activity start) − lead time − review days. */
export const computeSubmitBy = ({
  requiredOnSite,
  activityStart,
  leadTimeWeeks,
  reviewDays,
}: {
  requiredOnSite?: string | null
  activityStart?: string | null
  leadTimeWeeks?: number | null
  reviewDays?: number | null
}): Date | null => {
  const anchor = requiredOnSite || activityStart
  if (!anchor) return null
  const date = new Date(anchor)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(
    date.getUTCDate() -
      (Number(leadTimeWeeks) || 0) * 7 -
      (Number(reviewDays) || 0)
  )
  return date
}

export const daysFromNow = (value?: string | null | Date) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000)
}

export const assigneeLabel = (
  assignee: SubmittalStepAssignee,
  nameOf: (userId: string) => string
) => {
  if (assignee.type === 'user') return nameOf(assignee.userId ?? '')
  if (assignee.type === 'party_role')
    return `${PARTY_ROLE_OPTIONS.find((role) => role.id === assignee.role)?.label ?? assignee.role} party`
  return (
    PROJECT_ROLE_OPTIONS.find((role) => role.id === assignee.role)?.label ??
    assignee.role ??
    'Role'
  )
}

export const stepSummary = (steps: SubmittalWorkflowStep[]) =>
  `${steps.length} step${steps.length === 1 ? '' : 's'} · ${reviewDaysFor(steps)} review days`
