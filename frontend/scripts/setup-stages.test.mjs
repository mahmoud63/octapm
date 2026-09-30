// The guided setup's stage mapping (PC-8): a pure reading of the readiness
// engine's answer. Node runs the TypeScript module directly (type stripping;
// the module imports types only).
import assert from 'node:assert/strict'
import {
  buildSetupStages,
  currentStageIndex,
  SETUP_STAGES,
  worstStatus,
} from '../src/features/projects/lib/setup-stages.ts'

const issue = (code, severity = 'warning') => ({ code, message: code, severity })

const step = (key, status, extra = {}) => ({
  key,
  label: key,
  description: '',
  status,
  requiredFor: ['baseline', 'progress', 'reporting'],
  critical: true,
  message: '',
  blockers: [],
  warnings: [],
  counts: {},
  action: { label: `Open ${key}`, target: { module: key } },
  ...extra,
})

const guide = (key, status) => ({
  key,
  label: key,
  status,
  count: 0,
  detail: '',
  target: { module: 'controls', child: key },
  href: null,
})

const readinessOf = (steps, gates = {}) => ({
  projectId: 'p',
  rulesetVersion: 'test',
  checkedAt: new Date(0).toISOString(),
  summary: {
    status: 'not_ready',
    completeSteps: 0,
    attentionSteps: 0,
    blockedSteps: 0,
    totalSteps: steps.length,
    blockingCount: 0,
    warningCount: 0,
    readyForBaseline: false,
    readyForProgress: false,
    nextAction: null,
  },
  gates: {
    baseline: {
      mode: 'block',
      ready: false,
      alreadyLocked: false,
      blockers: [issue('UNALLOCATED_BOQ', 'blocking')],
      message: 'Map the bill first.',
      ...(gates.baseline ?? {}),
    },
    progress: {
      mode: 'warn',
      ready: false,
      blockers: [],
      warnings: [],
      message: 'Progress is available with setup warnings.',
      ...(gates.progress ?? {}),
    },
    reporting: {
      mode: 'block',
      ready: false,
      blockers: [],
      warnings: [],
      overrideAllowedRoles: ['pm'],
      message: 'Resolve reporting blockers.',
    },
  },
  steps,
})

const fullSteps = () => [
  step('project_profile', 'complete'),
  step('structure_setup', 'attention', {
    requiredFor: [],
    warnings: [issue('NO_LOCATIONS')],
    guides: [guide('wbs', 'complete'), guide('locations', 'attention'), guide('cost_codes', 'complete')],
  }),
  step('boq_upload', 'complete'),
  step('boq_approval', 'attention', { requiredFor: [], warnings: [issue('PENDING_BOQ_REVISION')] }),
  step('schedule_generation', 'complete'),
  step('boq_allocation', 'blocked', { blockers: [issue('UNALLOCATED_BOQ', 'blocking')] }),
  step('cost_loading_review', 'blocked', {
    requiredFor: ['reporting'],
    blockers: [issue('NO_REPORTING_PERIODS', 'blocking')],
  }),
  step('engineer_assignment', 'attention', { requiredFor: [], warnings: [issue('ENGINEER_ASSIGNMENTS_INCOMPLETE')] }),
  step('progress_method_configuration', 'complete', { requiredFor: ['reporting'] }),
  step('schedule_approval', 'complete'),
  step('baseline_readiness', 'blocked', { blockers: [issue('SCHEDULE_ALLOCATIONS_FAILED', 'blocking')] }),
  step('progress_readiness', 'blocked', {
    requiredFor: ['progress', 'reporting'],
    blockers: [issue('BASELINE_NOT_LOCKED', 'blocking')],
  }),
]

// Ten stages in §32's order.
assert.deepEqual(
  SETUP_STAGES.map((stage) => stage.label),
  ['Project', 'WBS / Structure', 'Locations', 'Cost Codes', 'BOQ', 'Schedule', 'Mapping', 'Validation', 'Baseline', 'Ready for Execution']
)

// Worst-of ordering.
assert.equal(worstStatus(['complete', 'attention']), 'attention')
assert.equal(worstStatus(['attention', 'pending']), 'pending')
assert.equal(worstStatus(['pending', 'blocked', 'complete']), 'blocked')
assert.equal(worstStatus([]), 'complete')

{
  const stages = buildSetupStages(readinessOf(fullSteps()))
  const byKey = Object.fromEntries(stages.map((stage) => [stage.key, stage]))
  assert.equal(byKey.project.status, 'complete')
  assert.equal(byKey.project.continueMode, 'continue')
  // The structure step splits: locations carries NO_LOCATIONS, WBS and cost
  // codes read their own guides and do not inherit the locations warning.
  assert.equal(byKey.structure.status, 'complete')
  assert.equal(byKey.locations.status, 'attention')
  assert.deepEqual(byKey.locations.warnings.map((w) => w.code), ['NO_LOCATIONS'])
  assert.equal(byKey.cost_codes.status, 'complete')
  assert.equal(byKey.cost_codes.warnings.length, 0)
  // BOQ: worst of upload (complete) and approval (attention).
  assert.equal(byKey.boq.status, 'attention')
  // A warning stage offers Continue with warning.
  assert.equal(byKey.boq.continueMode, 'warn')
  // Mapping blocked: its blocker stops the baseline gate, not the next stage.
  assert.equal(byKey.mapping.status, 'blocked')
  assert.equal(byKey.mapping.continueMode, 'warn')
  // The baseline gate (block mode, not ready) refuses Continue past stage 9.
  assert.equal(byKey.baseline.continueMode, 'block')
  assert.deepEqual(byKey.baseline.gateBlockers.map((b) => b.code), ['UNALLOCATED_BOQ'])
  // Execution: worst of its four members; the last stage.
  assert.equal(byKey.execution.status, 'blocked')
  assert.equal(byKey.execution.continueMode, 'end')
  // Issues carry the step they came from.
  assert.equal(byKey.mapping.blockers[0].stepKey, 'boq_allocation')
  // The current stage is the first gated unfinished one (Mapping), never an
  // advisory one (Locations, BOQ approval).
  assert.equal(stages[currentStageIndex(stages)].key, 'mapping')
}

// Gate ready but not locked: Continue past the baseline is a warning (the
// progress gate is warn mode) — never stricter than the engine.
{
  const stages = buildSetupStages(
    readinessOf(fullSteps(), { baseline: { ready: true, blockers: [], message: 'Baseline can be locked.' } })
  )
  const baseline = stages.find((stage) => stage.key === 'baseline')
  assert.equal(baseline.continueMode, 'warn')
  assert.match(baseline.continueReason, /Baseline can be locked/)
}

// Locked: Continue.
{
  const stages = buildSetupStages(
    readinessOf(fullSteps(), { baseline: { ready: true, alreadyLocked: true, blockers: [], message: 'Baseline is already locked.' } })
  )
  assert.equal(stages.find((stage) => stage.key === 'baseline').continueMode, 'continue')
}

// No fake completeness: an engine without the structure step (or without a
// guide) leaves stages 2–4 "not checked", never PASS.
{
  const steps = fullSteps().filter((entry) => entry.key !== 'structure_setup')
  const stages = buildSetupStages(readinessOf(steps))
  for (const key of ['structure', 'locations', 'cost_codes']) {
    const stage = stages.find((entry) => entry.key === key)
    assert.equal(stage.status, 'not_checked', `${key} not checked without its step`)
    assert.equal(stage.steps.length, 0)
  }
  const noGuides = fullSteps().map((entry) =>
    entry.key === 'structure_setup' ? { ...entry, guides: [] } : entry
  )
  const stagesNoGuides = buildSetupStages(readinessOf(noGuides))
  assert.equal(stagesNoGuides.find((entry) => entry.key === 'cost_codes').status, 'not_checked')
  // A stage with one of two members missing is never complete.
  const partial = fullSteps()
    .filter((entry) => entry.key !== 'boq_approval')
    .map((entry) => (entry.key === 'boq_upload' ? { ...entry, status: 'complete' } : entry))
  assert.equal(buildSetupStages(readinessOf(partial)).find((entry) => entry.key === 'boq').status, 'not_checked')
}

// Every stage done and the baseline locked: current is the last stage.
{
  const steps = fullSteps().map((entry) => ({
    ...entry,
    status: 'complete',
    blockers: [],
    warnings: [],
    guides: entry.guides?.map((g) => ({ ...g, status: 'complete' })),
  }))
  const stages = buildSetupStages(
    readinessOf(steps, { baseline: { ready: true, alreadyLocked: true, blockers: [] } })
  )
  assert.ok(stages.every((stage) => stage.status === 'complete'))
  assert.equal(currentStageIndex(stages), stages.length - 1)
}

console.log('setup-stages: all assertions passed')
