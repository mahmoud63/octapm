/**
 * The guided setup's ten stages (PC-8, owner §32), laid over the readiness
 * engine's steps. This module is a pure reading of the engine's answer: it
 * never recomputes a figure, never invents a check and never shows a stage
 * as done that the engine did not check (no fake completeness — a stage with
 * no member check reads "Not checked"). It imports types only, so node can
 * run it directly in the source test (scripts/setup-stages.test.mjs).
 */
import type {
  ProjectSetupGuide,
  ProjectSetupIssue,
  ProjectSetupReadiness,
  ProjectSetupStep,
  ProjectSetupTarget,
} from '../data/schema'
import type { StatusTone } from '@/lib/status'

export type StageStatus =
  | 'complete'
  | 'attention'
  | 'blocked'
  | 'pending'
  | 'not_checked'

type CheckedStatus = Exclude<StageStatus, 'not_checked'>

/**
 * One check a stage reads: a whole engine step, or — for the structure step,
 * which checks WBS, locations and cost codes at once — the part of it one
 * structure guide and its own issue codes cover.
 */
type StageMember = {
  stepKey: string
  /** The structure guide (steps[].guides[].key) whose verdict this stage reads. */
  guideKey?: string
  /** Only the issues with these codes belong to the stage. */
  codes?: string[]
  /** Every issue except these codes belongs to the stage. */
  excludeCodes?: string[]
}

type StageDefinition = {
  number: number
  key: string
  label: string
  members: StageMember[]
}

const LOCATION_CODES = ['NO_LOCATIONS']
const COST_CODE_CODES = ['NO_PROJECT_COST_CODES']

/**
 * §32's order: structure → BOQ → schedule → mapping → validation → baseline
 * → execution. Validation is the schedule's approval (the server grants it
 * only when the schedule's own checks pass); execution gathers what progress
 * entry and official reporting need.
 */
export const SETUP_STAGES: readonly StageDefinition[] = [
  { number: 1, key: 'project', label: 'Project', members: [{ stepKey: 'project_profile' }] },
  {
    number: 2,
    key: 'structure',
    label: 'WBS / Structure',
    members: [
      {
        stepKey: 'structure_setup',
        guideKey: 'wbs',
        excludeCodes: [...LOCATION_CODES, ...COST_CODE_CODES],
      },
    ],
  },
  {
    number: 3,
    key: 'locations',
    label: 'Locations',
    members: [{ stepKey: 'structure_setup', guideKey: 'locations', codes: LOCATION_CODES }],
  },
  {
    number: 4,
    key: 'cost_codes',
    label: 'Cost Codes',
    members: [{ stepKey: 'structure_setup', guideKey: 'cost_codes', codes: COST_CODE_CODES }],
  },
  {
    number: 5,
    key: 'boq',
    label: 'BOQ',
    members: [{ stepKey: 'boq_upload' }, { stepKey: 'boq_approval' }],
  },
  { number: 6, key: 'schedule', label: 'Schedule', members: [{ stepKey: 'schedule_generation' }] },
  { number: 7, key: 'mapping', label: 'Mapping', members: [{ stepKey: 'boq_allocation' }] },
  { number: 8, key: 'validation', label: 'Validation', members: [{ stepKey: 'schedule_approval' }] },
  { number: 9, key: 'baseline', label: 'Baseline', members: [{ stepKey: 'baseline_readiness' }] },
  {
    number: 10,
    key: 'execution',
    label: 'Ready for Execution',
    members: [
      { stepKey: 'progress_readiness' },
      { stepKey: 'cost_loading_review' },
      { stepKey: 'progress_method_configuration' },
      { stepKey: 'engineer_assignment' },
    ],
  },
]

/** The stage whose Continue crosses the baseline gate. */
export const BASELINE_STAGE_KEY = 'baseline'
/** The last stage: its Continue is the progress gate, beside the reporting gate. */
export const EXECUTION_STAGE_KEY = 'execution'

/**
 * What Continue does at the end of a stage, reproducing the engine's gates
 * exactly (setup doc §4): warnings never block; only a gate in `block` mode
 * that is not ready does.
 *  - continue: nothing in the way.
 *  - warn: proceed with the warnings shown ("Continue with warning").
 *  - block: a blocking gate stands in the way; Continue is refused.
 *  - end: the last stage; its gates are shown instead.
 */
export type ContinueMode = 'continue' | 'warn' | 'block' | 'end'

export type StageIssue = ProjectSetupIssue & { stepKey: string; stepLabel: string }

export type StageStepView = {
  step: ProjectSetupStep
  /** The structure guide this stage reads, when it reads one. */
  guide: ProjectSetupGuide | null
  status: StageStatus
}

export type SetupStage = {
  number: number
  key: string
  label: string
  status: StageStatus
  /** The member checks the engine answered; empty when it answered none. */
  steps: StageStepView[]
  blockers: StageIssue[]
  warnings: StageIssue[]
  advisories: StageIssue[]
  /** Where the stage's work is done: the first unfinished member's action. */
  action: { label: string; target: ProjectSetupTarget } | null
  /** Whether a step here is required for a gate (false: advisory only). */
  gated: boolean
  continueMode: ContinueMode
  /** Why Continue reads as it does, in the engine's words where it has them. */
  continueReason: string
  /** The gate blockers that refuse Continue (block mode only). */
  gateBlockers: ProjectSetupIssue[]
}

const RANK: Record<CheckedStatus, number> = {
  complete: 0,
  attention: 1,
  pending: 2,
  blocked: 3,
}

/** The worst of some checked statuses (complete when there are none). */
export const worstStatus = (statuses: CheckedStatus[]): CheckedStatus =>
  statuses.reduce<CheckedStatus>(
    (worst, status) => (RANK[status] > RANK[worst] ? status : worst),
    'complete'
  )

const issueBelongs = (issue: ProjectSetupIssue, member: StageMember) => {
  if (member.codes) return member.codes.includes(issue.code)
  if (member.excludeCodes) return !member.excludeCodes.includes(issue.code)
  return true
}

const tagged = (
  issues: ProjectSetupIssue[] | undefined,
  step: ProjectSetupStep,
  member: StageMember
): StageIssue[] =>
  (issues ?? [])
    .filter((issue) => issueBelongs(issue, member))
    .map((issue) => ({ ...issue, stepKey: step.key, stepLabel: step.label }))

/**
 * A member's status. A whole step's status is the engine's. A structure
 * facet is checked only when its guide is there: the guide's verdict, made
 * worse by any of the stage's own issues on the step.
 */
const memberStatus = (
  step: ProjectSetupStep,
  guide: ProjectSetupGuide | null,
  member: StageMember,
  blockers: StageIssue[],
  warnings: StageIssue[]
): StageStatus => {
  if (!member.guideKey) return step.status
  if (!guide) return 'not_checked'
  const fromIssues: CheckedStatus =
    blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'attention' : 'complete'
  return worstStatus([guide.status, fromIssues])
}

const stageStatus = (views: StageStepView[], memberCount: number): StageStatus => {
  const checked = views.filter((view) => view.status !== 'not_checked')
  if (checked.length === 0) return 'not_checked'
  const worst = worstStatus(checked.map((view) => view.status as CheckedStatus))
  // Complete only when every member was checked and passed: a member the
  // engine did not answer never counts as done.
  if (worst === 'complete' && checked.length < memberCount) return 'not_checked'
  return worst
}

/** The mildest status a stage may show under its own Continue. */
const GATE_FLOOR: Partial<Record<ContinueMode, CheckedStatus>> = {
  block: 'blocked',
  warn: 'attention',
}

/**
 * A stage's status is never milder than its own gate: the baseline step
 * reads 'attention' while it waits for the approval, yet the baseline gate
 * already refuses the lock — the stage reads Blocked, as its Continue does.
 */
const flooredByGate = (status: StageStatus, mode: ContinueMode): StageStatus => {
  const floor = GATE_FLOOR[mode]
  if (!floor) return status
  return status === 'not_checked' ? floor : worstStatus([status, floor])
}

const baselineContinue = (readiness: ProjectSetupReadiness) => {
  const gate = readiness.gates.baseline
  if (gate.alreadyLocked) {
    return { mode: 'continue' as const, reason: gate.message, blockers: [] }
  }
  if (gate.mode === 'block' && !gate.ready) {
    return { mode: 'block' as const, reason: gate.message, blockers: gate.blockers }
  }
  // Ready but not locked: the gate lets the lock through; execution before
  // the lock is the progress gate's warning (mode warn), never a refusal.
  return {
    mode: 'warn' as const,
    reason: `${gate.message} Progress entered before the lock carries the setup warnings.`,
    blockers: [],
  }
}

const preparationContinue = (stage: { status: StageStatus; blockers: StageIssue[]; warnings: StageIssue[] }) => {
  if (stage.status === 'complete') {
    return { mode: 'continue' as const, reason: 'This stage is clear.' }
  }
  if (stage.status === 'not_checked') {
    return { mode: 'continue' as const, reason: 'The readiness check does not check this stage.' }
  }
  // A blocker here blocks a gate further on (the baseline lock or official
  // reporting), never the next stage: the flow goes on, and the gate refuses
  // where it stands.
  if (stage.blockers.length > 0) {
    return {
      mode: 'warn' as const,
      reason:
        'Blockers here stop a gate further on (the baseline lock or official reporting); you may continue and come back.',
    }
  }
  return {
    mode: 'warn' as const,
    reason:
      stage.warnings.length > 0
        ? 'Warnings here do not block a gate; you may continue.'
        : 'Not finished yet; nothing here blocks the next stage.',
  }
}

/** The ten stages, read off one readiness answer. */
export function buildSetupStages(readiness: ProjectSetupReadiness): SetupStage[] {
  const stepByKey = new Map(readiness.steps.map((step) => [step.key, step]))

  return SETUP_STAGES.map((definition) => {
    const views: StageStepView[] = []
    const blockers: StageIssue[] = []
    const warnings: StageIssue[] = []
    const advisories: StageIssue[] = []
    let gated = false

    for (const member of definition.members) {
      const step = stepByKey.get(member.stepKey)
      if (!step) continue
      const guide = member.guideKey
        ? ((step.guides ?? []).find((entry) => entry.key === member.guideKey) ?? null)
        : null
      const ownBlockers = tagged(step.blockers, step, member)
      const ownWarnings = tagged(step.warnings, step, member)
      blockers.push(...ownBlockers)
      warnings.push(...ownWarnings)
      advisories.push(...tagged(step.advisories, step, member))
      if (step.requiredFor.length > 0) gated = true
      views.push({
        step,
        guide,
        status: memberStatus(step, guide, member, ownBlockers, ownWarnings),
      })
    }

    const status = stageStatus(views, definition.members.length)
    const unfinished = views.find(
      (view) => view.status !== 'complete' && view.status !== 'not_checked'
    )
    const actionView = unfinished ?? views[0]
    const action = actionView
      ? actionView.guide?.target
        ? { label: `Open ${actionView.guide.label}`, target: actionView.guide.target }
        : actionView.step.action
      : null

    let continueMode: ContinueMode
    let continueReason: string
    let gateBlockers: ProjectSetupIssue[] = []
    if (definition.key === BASELINE_STAGE_KEY) {
      const gate = baselineContinue(readiness)
      continueMode = gate.mode
      continueReason = gate.reason
      gateBlockers = gate.blockers
    } else if (definition.key === EXECUTION_STAGE_KEY) {
      continueMode = 'end'
      continueReason = readiness.gates.progress.message
    } else {
      const next = preparationContinue({ status, blockers, warnings })
      continueMode = next.mode
      continueReason = next.reason
    }

    return {
      number: definition.number,
      key: definition.key,
      label: definition.label,
      status: flooredByGate(status, continueMode),
      steps: views,
      blockers,
      warnings,
      advisories,
      action,
      gated,
      continueMode,
      continueReason,
      gateBlockers,
    }
  })
}

/**
 * The one current stage: the first whose gated work is unfinished (a gated
 * step blocked or not started) or whose Continue a gate refuses. Advisory
 * steps (structure, the bill's approval, engineer assignment) never hold the
 * flow, as the engine's nextAction never takes them. With nothing left, the
 * last stage.
 */
export function currentStageIndex(stages: SetupStage[]): number {
  const index = stages.findIndex(
    (stage) =>
      stage.continueMode === 'block' ||
      stage.steps.some(
        (view) =>
          view.step.requiredFor.length > 0 &&
          (view.status === 'blocked' || view.status === 'pending')
      )
  )
  return index === -1 ? stages.length - 1 : index
}

/** A status's words on the stepper. */
export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  complete: 'PASS',
  attention: 'Warning',
  blocked: 'Blocked',
  pending: 'To do',
  not_checked: 'Not checked',
}

/** A status's tone in the product's semantic palette (lib/status). */
export const STAGE_TONE: Record<StageStatus, StatusTone> = {
  complete: 'done',
  attention: 'review',
  blocked: 'blocked',
  pending: 'neutral',
  not_checked: 'neutral',
}
