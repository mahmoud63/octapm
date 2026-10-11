import { AiAction } from './ai-action'

/**
 * The one to three AI actions a project module offers, above its content
 * (AI UX correction, 2026-10-11). Each opens the Ask OctaPM drawer over the
 * module and asks there; the server reads the module's own deterministic
 * results (the CPM results on Schedule…) under the caller's access.
 */
interface ModuleAction {
  label: string
  question: string
}

const SCHEDULE_DEFAULT: ModuleAction[] = [
  {
    label: 'Explain Critical Path',
    question:
      'Explain the critical path: which open activities drive the finish date, in what order, and what that means for the team.',
  },
  {
    label: 'Explain Delay',
    question:
      'Which activities are delayed, by how much, and which of them are on the critical path?',
  },
  {
    label: 'Explain Float',
    question:
      'Which activities have the least float, and which could become critical next?',
  },
]

const ACTIONS: Record<string, ModuleAction[]> = {
  cost: [
    {
      label: 'Explain Cost',
      question:
        'Explain the cost position: budget, committed, actual and forecast, and which activities drive it. Use only the cost ledger and forecast figures.',
    },
    {
      label: 'Explain Variance',
      question:
        'Where does actual cost exceed budget, by how much, and why do the records say it happened?',
    },
    {
      label: 'Explain Forecast',
      question:
        'Explain the cost forecast: the estimate at completion, its basis and range, and the activities driving any overrun.',
    },
  ],
  boq: [
    {
      label: 'Explain BOQ Coverage',
      question:
        'Explain the BOQ coverage: how much of the BOQ is allocated, approved, pending, scheduled and unallocated, and what that means for earned value.',
    },
    {
      label: 'Find Unallocated Scope',
      question:
        'Which BOQ rows are unallocated, partly allocated or over-allocated, largest first, and what should be done about each?',
    },
    {
      label: 'Explain Allocation',
      question:
        'Explain how the BOQ is allocated to activities: what is approved, what is still pending approval, and where allocations look unusual.',
    },
  ],
}

const COMMERCIAL_RISK: ModuleAction = {
  label: 'Summarize Commercial Risk',
  question:
    'Summarize the commercial risk on this project from the cost ledger, forecast, commitments and cash flow: where money is at risk and why.',
}

// Per sub-tab, when it differs from its module's actions.
const CHILD_ACTIONS: Record<string, ModuleAction[]> = {
  'commercial:commitments': [
    {
      label: 'Explain Commitments',
      question:
        'Explain the commitments: what is committed with whom, against what budget, and where commitments exceed budget.',
    },
    COMMERCIAL_RISK,
  ],
  'commercial:cash-flow': [
    {
      label: 'Explain Cash Flow',
      question:
        'Explain the cash flow: inflow, outflow and net by month, and what stands out.',
    },
    COMMERCIAL_RISK,
  ],
}

const actionsFor = (module: string, child: string | null): ModuleAction[] => {
  if (child && CHILD_ACTIONS[`${module}:${child}`]) return CHILD_ACTIONS[`${module}:${child}`]
  if (ACTIONS[module]) return ACTIONS[module]
  if (module === 'schedule') {
    if (child === 'progress')
      return [
        {
          label: 'Summarize Progress',
          question:
            'Summarize progress: official (approved) progress first, then what is submitted and still awaiting approval. Never count submitted progress as official.',
        },
        {
          label: 'What is Awaiting Approval?',
          question:
            'Which progress submissions are awaiting approval, how far does each differ from the official figure, and how long have they waited?',
        },
        {
          label: 'Explain Variance',
          question:
            'Where does submitted progress differ most from the official approved progress, and what was rejected recently and why?',
        },
      ]
    if (child === 'forecast')
      return [
        {
          label: 'Explain Forecast',
          question:
            'Explain the schedule forecast: the activities driving the forecast finish and the delays behind it.',
        },
      ]
    return SCHEDULE_DEFAULT
  }
  return []
}

export function ModuleAiActions({
  module,
  child,
}: {
  module: string
  child: string | null
}) {
  const actions = actionsFor(module, child)
  if (!actions.length) return null
  return (
    <div
      className='mt-2 flex flex-wrap items-center justify-end gap-2'
      data-testid={`uat-module-ai-actions-${module}`}
    >
      {actions.map((action) => (
        <AiAction
          key={action.label}
          label={action.label}
          question={action.question}
          variant='ghost'
        />
      ))}
    </div>
  )
}
