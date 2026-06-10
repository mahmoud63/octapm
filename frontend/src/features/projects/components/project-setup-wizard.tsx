import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ListChecks,
  Lock,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ProjectSetupReadiness,
  ProjectSetupStep,
  ProjectSetupTarget,
} from '../data/schema'

type Props = {
  readiness?: ProjectSetupReadiness
  isLoading?: boolean
  onNavigate: (target: ProjectSetupTarget) => void
}

const statusMeta = {
  complete: {
    label: 'Done',
    icon: CheckCircle2,
    className:
      'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
    iconClassName: 'text-emerald-600',
  },
  attention: {
    label: 'Review',
    icon: Clock3,
    className:
      'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
    iconClassName: 'text-amber-600',
  },
  blocked: {
    label: 'Blocked',
    icon: AlertTriangle,
    className:
      'border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200',
    iconClassName: 'text-rose-600',
  },
  pending: {
    label: 'Pending',
    icon: CircleDashed,
    className:
      'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/60 dark:text-slate-200',
    iconClassName: 'text-slate-500',
  },
}

const countLabels: Record<string, string> = {
  boqItems: 'BOQ',
  totalBoqAmount: 'BOQ value',
  activeActivities: 'Activities',
  progressActivities: 'Progress acts',
  criticalActivities: 'Critical',
  milestones: 'Milestones',
  approvedAllocatedAmount: 'Approved',
  pendingAllocatedAmount: 'Pending',
  unallocatedAmount: 'Unallocated',
  costRecords: 'Cost rows',
  approvedCostLoadingRows: 'Load rows',
  reportingPeriods: 'Periods',
  assignedProgressActivities: 'Assigned',
  progressMethodCount: 'Methods',
  readinessBlockingCount: 'Readiness',
  revisionStatus: 'Status',
}

function labelFor(key: string) {
  return (
    countLabels[key] ||
    key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (char) => char.toUpperCase())
  )
}

function formatCount(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: value > 1000 ? 0 : 2,
    })
  }
  if (typeof value === 'string') {
    return value.replace(/_/g, ' ')
  }
  return null
}

function countChips(step: ProjectSetupStep) {
  return Object.entries(step.counts)
    .filter(([key, value]) => {
      if (value == null) return false
      if (String(key).toLowerCase().includes('id')) return false
      return ['number', 'boolean', 'string'].includes(typeof value)
    })
    .slice(0, 4)
}

function StepCard({
  step,
  onNavigate,
}: {
  step: ProjectSetupStep
  onNavigate: (target: ProjectSetupTarget) => void
}) {
  const meta = statusMeta[step.status] ?? statusMeta.pending
  const Icon = meta.icon
  const chips = countChips(step)

  return (
    <div className='flex min-h-35 flex-col justify-between rounded-md border bg-background p-3'>
      <div className='space-y-3'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <Icon className={cn('h-4 w-4 shrink-0', meta.iconClassName)} />
              <h4 className='truncate text-sm font-semibold'>{step.label}</h4>
            </div>
            <p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
              {step.message}
            </p>
          </div>
          <Badge variant='outline' className={cn('shrink-0', meta.className)}>
            {meta.label}
          </Badge>
        </div>

        {chips.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {chips.map(([key, value]) => {
              const formatted = formatCount(value)
              if (!formatted) return null

              return (
                <span
                  key={key}
                  className='rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground'
                >
                  {labelFor(key)}: {formatted}
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div className='mt-3 flex items-center justify-between gap-2'>
        {step.critical ? (
          <span className='text-[11px] font-medium text-muted-foreground'>
            Gate: {step.requiredFor.join(', ')}
          </span>
        ) : (
          <span className='text-[11px] text-muted-foreground'>Advisory</span>
        )}
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-8 px-2'
          onClick={() => onNavigate(step.action.target)}
        >
          {step.action.label}
          <ArrowRight className='h-3.5 w-3.5' />
        </Button>
      </div>
    </div>
  )
}

export function ProjectSetupWizard({
  readiness,
  isLoading,
  onNavigate,
}: Props) {
  if (isLoading && !readiness) {
    return (
      <section className='rounded-md border bg-card p-4'>
        <div className='h-5 w-44 animate-pulse rounded bg-muted' />
        <div className='mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className='h-32 animate-pulse rounded-md border bg-muted/40'
            />
          ))}
        </div>
      </section>
    )
  }

  if (!readiness) return null

  const progress =
    readiness.summary.totalSteps > 0
      ? Math.round(
          (readiness.summary.completeSteps / readiness.summary.totalSteps) * 100
        )
      : 0
  const nextAction = readiness.summary.nextAction
  const progressGate = readiness.gates.progress
  const baselineGate = readiness.gates.baseline

  return (
    <section className='rounded-md border bg-card p-4'>
      <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
        <div className='min-w-0 space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <ListChecks className='h-4 w-4 text-primary' />
            <h3 className='text-base font-semibold'>Setup Readiness</h3>
            <Badge
              variant='outline'
              className={
                progressGate.ready
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }
            >
              {progressGate.ready ? 'Ready for progress' : 'Setup in progress'}
            </Badge>
            {baselineGate.alreadyLocked ? (
              <Badge variant='secondary'>
                <Lock className='h-3.5 w-3.5' />
                Baseline locked
              </Badge>
            ) : baselineGate.ready ? (
              <Badge variant='secondary'>
                <ShieldCheck className='h-3.5 w-3.5' />
                Baseline ready
              </Badge>
            ) : null}
          </div>

          <div className='max-w-3xl text-sm text-muted-foreground'>
            {nextAction ? nextAction.message : 'All setup checks are clear.'}
          </div>

          <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
            <span>
              {readiness.summary.completeSteps}/{readiness.summary.totalSteps}{' '}
              complete
            </span>
            <span>{readiness.summary.blockingCount} blockers</span>
            <span>{readiness.summary.warningCount} warnings</span>
            <span>Checked {new Date(readiness.checkedAt).toLocaleString()}</span>
          </div>

          <div className='h-2 max-w-xl rounded-full bg-muted'>
            <div
              className={cn(
                'h-2 rounded-full transition-all',
                progressGate.ready ? 'bg-emerald-500' : 'bg-primary'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {nextAction && (
          <Button
            type='button'
            onClick={() => onNavigate(nextAction.target)}
            className='w-full sm:w-fit'
          >
            {nextAction.label}
            <ArrowRight className='h-4 w-4' />
          </Button>
        )}
      </div>

      <div className='mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
        {readiness.steps.map((step) => (
          <StepCard key={step.key} step={step} onNavigate={onNavigate} />
        ))}
      </div>
    </section>
  )
}
