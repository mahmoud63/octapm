# Task 48 — Schedule Generation Progress Indicator (FR-104)

## Gap Covered
- 3-step labelled progress indicator shown during AI schedule generation (Pass 1, Pass 2, Pass 3)

## BRD Refs
- FR-104: Visual progress indicator with labelled steps during schedule generation

## DB Schema Changes
None.

## Backend Changes

### File: `backend/src/services/schedule.service.js`
Update the job status object to include a `steps` array and `currentStep` index:

```js
// Job status structure (update all jobs.set() calls to include steps):
const JOB_STEPS = [
  { label: 'Pass 1: Structuring BOQ',        description: 'Parsing and organising scope items' },
  { label: 'Pass 2: Generating CPM Schedule', description: 'Computing activities, durations, and dependencies' },
  { label: 'Pass 3: Allocating Resources',    description: 'Assigning labor, equipment, and materials' },
];

// When starting job:
jobs.set(jobId, {
  status: 'running',
  step: JOB_STEPS[0].label,
  currentStep: 0,
  totalSteps: 3,
  steps: JOB_STEPS,
  progress: 5,
});

// After Pass 1 complete:
jobs.set(jobId, {
  ...jobs.get(jobId),
  step: JOB_STEPS[1].label,
  currentStep: 1,
  progress: 40,
});

// After Pass 2 complete:
jobs.set(jobId, {
  ...jobs.get(jobId),
  step: JOB_STEPS[2].label,
  currentStep: 2,
  progress: 80,
});

// After Pass 3 complete (or skipped):
jobs.set(jobId, {
  status: 'done',
  currentStep: 3,
  totalSteps: 3,
  progress: 100,
  activityCount: savedActivities.length,
  steps: JOB_STEPS,
});
```

The `GET /projects/:projectId/schedule/job/:jobId` endpoint already returns the job object — no route changes needed.

## Frontend Changes

### New file: `frontend/src/features/schedule/components/generation-progress.tsx`

```tsx
interface Step {
  label: string
  description: string
}

interface Props {
  currentStep: number   // 0-indexed; 3 = done
  totalSteps: number
  steps: Step[]
  progress: number      // 0–100
  step: string          // current step label for display
}

export function GenerationProgress({ currentStep, totalSteps, steps, progress, step }: Props) {
  return (
    <div className='rounded-lg border p-6 space-y-6'>
      <div className='text-center'>
        <p className='text-sm font-medium text-muted-foreground'>Generating Schedule</p>
        <p className='text-lg font-semibold mt-1'>{step}</p>
      </div>

      {/* Step indicators */}
      <div className='flex items-center justify-between'>
        {steps.map((s, i) => {
          const isDone = i < currentStep
          const isActive = i === currentStep
          const isPending = i > currentStep

          return (
            <div key={i} className='flex flex-col items-center flex-1'>
              {/* Connector line */}
              <div className='flex items-center w-full'>
                {i > 0 && (
                  <div className={`flex-1 h-0.5 ${isDone || isActive ? 'bg-blue-500' : 'bg-muted'}`} />
                )}
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                    ${isDone ? 'bg-green-500 text-white' : ''}
                    ${isActive ? 'bg-blue-500 text-white ring-4 ring-blue-100' : ''}
                    ${isPending ? 'bg-muted text-muted-foreground' : ''}
                  `}
                >
                  {isDone ? '✓' : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 ${isDone ? 'bg-green-500' : 'bg-muted'}`} />
                )}
              </div>
              {/* Step label */}
              <p className={`text-xs mt-2 text-center max-w-[100px] ${isActive ? 'font-semibold text-blue-600' : isPending ? 'text-muted-foreground' : 'text-green-700'}`}>
                {s.label.replace(/Pass \d+: /, '')}
              </p>
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className='space-y-1'>
        <div className='flex justify-between text-xs text-muted-foreground'>
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div className='h-2 rounded-full bg-muted overflow-hidden'>
          <div
            className='h-2 rounded-full bg-blue-500 transition-all duration-500'
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Animated dots */}
      <p className='text-center text-sm text-muted-foreground'>
        This usually takes 30–90 seconds
        <span className='animate-pulse'>…</span>
      </p>
    </div>
  )
}
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Replace the existing plain "Generating…" spinner with `<GenerationProgress>`:

```tsx
// In the job polling section, replace:
// <div>Generating: {jobStatus?.step}</div>

// With:
{jobStatus?.status === 'running' && (
  <GenerationProgress
    currentStep={jobStatus.currentStep ?? 0}
    totalSteps={jobStatus.totalSteps ?? 3}
    steps={jobStatus.steps ?? [
      { label: 'Pass 1: Structuring BOQ', description: '' },
      { label: 'Pass 2: Generating CPM Schedule', description: '' },
      { label: 'Pass 3: Allocating Resources', description: '' },
    ]}
    progress={jobStatus.progress ?? 0}
    step={jobStatus.step ?? 'Processing…'}
  />
)}
```

Keep the existing polling interval (e.g. every 3 seconds via `refetchInterval: 3000`).

## Acceptance Criteria
- [ ] 3 labelled steps shown: Pass 1 (BOQ), Pass 2 (CPM), Pass 3 (Resources)
- [ ] Active step highlighted in blue with ring
- [ ] Completed steps shown in green with ✓
- [ ] Pending steps shown in grey
- [ ] Progress bar animates from 0→100% as job progresses
- [ ] Job status returns currentStep, totalSteps, progress, steps array
- [ ] Progress indicator replaces plain spinner during generation
