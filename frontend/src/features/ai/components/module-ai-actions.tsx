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

const actionsFor = (module: string, child: string | null): ModuleAction[] => {
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
