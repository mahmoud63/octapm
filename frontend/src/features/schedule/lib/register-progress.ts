import type { ScheduleActivity } from '../data/schema'

// The progress-side fields the activity register carries and the schedule
// payload does not: GET /projects/:id/schedule sends an activity's approved
// percentage only, while GET /projects/:id/activities (sanitizeActivity)
// also sends its pending submission, its progress method, the source of its
// approved figure, who is assigned, and — with PC-6 core — the structured
// PROGRESS SOURCE, installed and planned quantities. The tab reads both and
// lets the register's fields win; a withheld budget stays withheld (both
// reads pass utils/boq-figures).
const PROGRESS_FIELDS = [
  'approvedProgressUpdatedAt',
  'approvedProgressSource',
  'progressMethod',
  'progressMethodConfig',
  'pendingProgress',
  'progressApprovalStatus',
  'assignedEngineers',
  'progressSource',
  'installedQuantity',
  'plannedQuantity',
  'pendingQuantityEntries',
] as const

export const withRegisterProgress = (
  activities: ScheduleActivity[],
  register: Array<Record<string, unknown>> | undefined
): ScheduleActivity[] => {
  if (!register?.length) return activities
  const byId = new Map(register.map((row) => [String(row.id), row]))
  return activities.map((activity) => {
    const row = byId.get(activity.id)
    if (!row) return activity
    const merged: Record<string, unknown> = { ...activity }
    for (const field of PROGRESS_FIELDS) {
      if (row[field] !== undefined) merged[field] = row[field]
    }
    return merged as ScheduleActivity
  })
}
