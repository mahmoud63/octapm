/**
 * What the controls strip's Schedule tile says under its status (owner
 * decision R5-4). A pure reading of the readiness engine's answer: which of
 * the three states the schedule is in is the engine's (summary.scheduleState)
 * and so is the verdict on a staged revision (the schedule step's blockers,
 * the headline's schedule_imported entry) — the tile never decides either.
 * It imports types only, so node can run it directly in the source test
 * (scripts/project-setup-readiness.test.mjs).
 */
import type { ProjectSetupReadiness } from '../data/schema'

export const WAITING_FOR_ACTIVATION = 'waiting for activation'
export const WAITING_FOR_ACTIVE_SCHEDULE = 'Waiting for active schedule'

type Reading = Pick<ProjectSetupReadiness, 'steps' | 'summary' | 'context'>

const scheduleStep = (readiness: Pick<ProjectSetupReadiness, 'steps'>) =>
  readiness.steps.find((step) => step.key === 'schedule_generation')

/**
 * What a staged revision — imported or generated, none of its activities
 * active — is waiting for. Only a revision the engine passes is "waiting
 * for activation": a rejected one needs resubmission and an empty one has
 * nothing to activate, and the headline on the same page says FAIL of both.
 */
export function stagedScheduleNote(readiness: Reading): string {
  const codes = (scheduleStep(readiness)?.blockers ?? []).map((blocker) => blocker.code)
  if (codes.includes('NO_ACTIVITIES')) return 'no activities in the revision'
  if (codes.includes('SCHEDULE_REJECTED') || readiness.context?.currentRevision?.status === 'rejected') {
    return 'rejected — needs resubmission'
  }
  const imported = readiness.summary.headline?.find((entry) => entry.key === 'schedule_imported')
  if (codes.length > 0 || imported?.raw === false) return 'not ready — see Setup Readiness'
  return WAITING_FOR_ACTIVATION
}

/** The line under the Schedule tile's status. */
export function scheduleTileDetail(
  readiness: Pick<ProjectSetupReadiness, 'steps' | 'summary' | 'context' | 'gates'>
): string {
  const revision = readiness.context?.currentRevision ?? null
  // Read off the active schedule: absent while none is active.
  const activities = Number(scheduleStep(readiness)?.counts?.activeActivities ?? 0)
  if (!revision) {
    return activities > 0
      ? 'No revision — import or generate one to review and baseline'
      : 'Generate or import a schedule'
  }
  const label = revision.label ? ` · ${revision.label}` : ''
  if (readiness.summary.scheduleState === 'staged') {
    // Imported, not in force: its activities are the revision's own, none
    // is active — "0 activities" would misstate it.
    return `Imported${label} · ${stagedScheduleNote(readiness)}`
  }
  const locked =
    readiness.gates.baseline.alreadyLocked && revision.baselinedAt
      ? ` · locked ${new Date(revision.baselinedAt).toLocaleDateString()}`
      : ''
  return `${activities.toLocaleString()} activities${label}${locked}`
}

/**
 * The Progress method tile's badge when there is nothing to configure. With
 * a revision staged the activities exist — they are not in force yet — so
 * "No activities" would contradict the import beside it.
 */
export function noProgressActivitiesBadge(readiness: Pick<ProjectSetupReadiness, 'summary'>): string {
  return readiness.summary.scheduleState === 'staged' ? WAITING_FOR_ACTIVE_SCHEDULE : 'No activities'
}
