interface GenerationStep {
  label: string
  description: string
}

interface Props {
  currentStep: number
  totalSteps: number
  steps: GenerationStep[]
  progress: number
  step: string
}

export function GenerationProgress({
  currentStep,
  totalSteps,
  steps,
  progress,
  step,
}: Props) {
  const safeSteps = steps.length > 0 ? steps : []

  return (
    <div className='space-y-5 rounded-lg border bg-card p-5'>
      <div className='text-center'>
        <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
          Generating Schedule
        </p>
        <p className='mt-1 text-base font-semibold'>{step}</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          {Math.min(currentStep + 1, totalSteps)}/{totalSteps} steps
        </p>
      </div>

      <div className='flex items-start justify-between gap-2'>
        {safeSteps.map((s, i) => {
          const done = i < currentStep
          const active = i === currentStep

          return (
            <div key={s.label} className='flex flex-1 flex-col items-center'>
              <div className='flex w-full items-center'>
                {i > 0 && (
                  <div
                    className={`h-0.5 flex-1 ${done || active ? 'bg-blue-500' : 'bg-muted'}`}
                  />
                )}
                <div
                  className={[
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    done
                      ? 'bg-green-500 text-white'
                      : active
                        ? 'bg-blue-500 text-white ring-4 ring-blue-100'
                        : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {done ? '✓' : i + 1}
                </div>
                {i < safeSteps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 ${done ? 'bg-green-500' : 'bg-muted'}`}
                  />
                )}
              </div>
              <p
                className={[
                  'mt-2 text-center text-xs',
                  done
                    ? 'text-green-700'
                    : active
                      ? 'font-semibold text-blue-600'
                      : 'text-muted-foreground',
                ].join(' ')}
              >
                {s.label.replace(/Pass\s*\d+:\s*/i, '')}
              </p>
            </div>
          )
        })}
      </div>

      <div className='space-y-1'>
        <div className='flex items-center justify-between text-xs text-muted-foreground'>
          <span>Progress</span>
          <span>{Math.max(0, Math.min(100, Math.round(progress)))}%</span>
        </div>
        <div className='h-2 overflow-hidden rounded-full bg-muted'>
          <div
            className='h-2 rounded-full bg-blue-500 transition-all duration-500'
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      </div>

      <p className='text-center text-xs text-muted-foreground'>
        This usually takes 30-90 seconds...
      </p>
    </div>
  )
}
