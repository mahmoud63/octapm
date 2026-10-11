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

const LONG_LEAD: ModuleAction = {
  label: 'Summarize Long-Lead Exposure',
  question:
    'Summarize long-lead exposure: which items are at risk against their order-by and required dates, and what the schedule depends on.',
}

const ACTIONS: Record<string, ModuleAction[]> = {
  quality: [
    {
      label: 'AI Summary',
      question:
        'Summarize quality on this project: the quality score and how it is made up, open NCRs, pending or failed inspections and open punch items.',
    },
    {
      label: 'What is Blocking Progress?',
      question:
        'Which NCRs, hold points and pending inspections are holding up activities, and what does each wait on?',
    },
    {
      label: 'Identify Quality Risks',
      question:
        'Which quality issues are overdue, repeated or severe, and where is quality risk concentrated?',
    },
  ],
  inventory: [
    {
      label: 'Identify Low Stock',
      question:
        'Which items are out of stock or below their reorder level, how short is each, and how long is its lead time?',
    },
    {
      label: 'Explain Stock',
      question:
        'Explain the stock position: value by warehouse, overstock and slow-moving items, and what was issued recently.',
    },
    {
      label: 'Material Risk',
      question:
        'Which materials are a supply risk given their stock, reorder levels and lead times?',
    },
  ],
  procurement: [
    {
      label: 'Identify Procurement Risk',
      question:
        'Which procurement items are at risk, why (order-by, delivery, lead-time alerts), and which activities do they affect?',
    },
    LONG_LEAD,
    {
      label: 'Compare Suppliers',
      question:
        'Compare the suppliers: their orders, status and lead-time reliability as recorded.',
    },
  ],
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

const CHANGE_ACTIONS: ModuleAction[] = [
  {
    label: 'Summarize Impact',
    question:
      'Summarize the change register: what is pending, its stated cost and schedule impact, and what has been approved. Pending changes do not change the contract.',
  },
  {
    label: 'Explain Cost Impact',
    question:
      'Explain the cost impact of the pending and approved changes, from their stated values and cost impact notes.',
  },
  {
    label: 'Explain Schedule Impact',
    question:
      'Explain the schedule impact of the changes: which activities they affect and the stated days of impact.',
  },
]

// Per sub-tab, when it differs from its module's actions.
const CHILD_ACTIONS: Record<string, ModuleAction[]> = {
  'commercial:bids': [
    {
      label: 'Compare Bids',
      question:
        'Compare the bids on each package: totals, normalised totals, plugged lines, exclusions, lead time and validity. Do not recommend an award as decided.',
    },
    {
      label: 'Explain Commercial Differences',
      question:
        'Explain the commercial differences between the bidders: what the plugged lines, inclusions and exclusions change in the comparison.',
    },
  ],
  'schedule:longLead': [LONG_LEAD],
  'commercial:change-orders': CHANGE_ACTIONS,
  'commercial:change-events': CHANGE_ACTIONS,
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
  if (module === 'commercial') return [COMMERCIAL_RISK]
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
