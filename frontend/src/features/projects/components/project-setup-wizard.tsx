import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  ListChecks,
  Lock,
  ShieldCheck,
} from 'lucide-react'
import { formatDateTime } from '@/lib/dates'
import { statusBadge, statusIcon, statusStripe } from '@/lib/status'
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
  /** Collapsed to the compact status bar, for focus on the working area. */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

/**
 * Step status uses the product-wide semantic tones (lib/status.ts) rather than
 * Tailwind palette colours, so Done is the same green here as everywhere else.
 */
const statusMeta = {
  complete: { label: 'Done', icon: CheckCircle2, tone: 'done' as const },
  attention: { label: 'Review', icon: Clock3, tone: 'review' as const },
  blocked: { label: 'Blocked', icon: AlertTriangle, tone: 'blocked' as const },
  pending: { label: 'Pending', icon: CircleDashed, tone: 'neutral' as const },
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
    key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
  )
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T|$)/

function formatCount(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: value > 1000 ? 0 : 2,
    })
  }
  if (typeof value === 'string') {
    // An approval timestamp is a moment, not an identifier: show it as one
    // rather than leaking the raw ISO string at the user.
    if (ISO_TIMESTAMP.test(value)) return formatDateTime(value)
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
    // Status reads from a leading stripe and a badge, not from flooding the
    // card — the card stays a neutral surface so the content is legible.
    <div className='relative flex min-h-35 flex-col justify-between overflow-hidden rounded-md border bg-card p-3 pl-3.5 shadow-[var(--shadow-card)]'>
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-[3px]', statusStripe(meta.tone))}
      />
      <div className='space-y-3'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <Icon className={cn('h-4 w-4 shrink-0', statusIcon(meta.tone))} />
              <h4 className='truncate text-sm font-semibold text-foreground'>
                {step.label}
              </h4>
            </div>
            <p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
              {step.message}
            </p>
          </div>
          <Badge variant='outline' className={cn('shrink-0', statusBadge(meta.tone))}>
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
  collapsed = false,
  onCollapsedChange,
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
  const reportingGate = readiness.gates.reporting

  // Gate badges, in the product's semantic tones. A gate that is genuinely
  // blocking reads red; one merely in progress reads amber; a satisfied one
  // reads green. Baseline readiness is informational until it is locked.
  const gateBadges = [
    {
      key: 'progress',
      label: progressGate.ready ? 'Ready for progress' : 'Setup in progress',
      tone: progressGate.ready ? ('done' as const) : ('review' as const),
      icon: progressGate.ready ? CheckCircle2 : Clock3,
    },
    ...(reportingGate
      ? [
          {
            key: 'reporting',
            label: reportingGate.ready ? 'Official reporting ready' : 'Reporting gated',
            tone: reportingGate.ready ? ('done' as const) : ('blocked' as const),
            icon: reportingGate.ready ? CheckCircle2 : AlertTriangle,
          },
        ]
      : []),
    ...(baselineGate.alreadyLocked
      ? [{ key: 'baseline', label: 'Baseline locked', tone: 'done' as const, icon: Lock }]
      : baselineGate.ready
        ? [{ key: 'baseline', label: 'Baseline ready', tone: 'info' as const, icon: ShieldCheck }]
        : []),
  ]

  // Collapsed: a compact enterprise status bar that keeps the whole state
  // legible in one line, so a working screen gets its vertical space back.
  if (collapsed) {
    return (
      <section className='rounded-md border bg-card shadow-[var(--shadow-card)]'>
        <button
          type='button'
          onClick={() => onCollapsedChange?.(false)}
          data-testid='uat-setup-readiness-expand'
          className='flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-3 py-2.5 text-start transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
        >
          <ListChecks className='h-4 w-4 shrink-0 text-primary' />
          <span className='text-sm font-semibold text-foreground'>Setup Readiness</span>

          <span className='flex flex-wrap items-center gap-1.5'>
            {gateBadges.map((gate) => (
              <Badge
                key={gate.key}
                variant='outline'
                className={cn('gap-1 px-1.5 py-0 text-[11px]', statusBadge(gate.tone))}
              >
                <gate.icon className='h-3 w-3' />
                {gate.label}
              </Badge>
            ))}
          </span>

          <span className='ms-auto flex items-center gap-3 text-xs'>
            <span className='font-medium text-foreground'>
              <span className='octa-numeric'>
                {readiness.summary.completeSteps}/{readiness.summary.totalSteps}
              </span>{' '}
              complete
            </span>
            {readiness.summary.blockingCount > 0 && (
              <span className={cn('font-medium', statusIcon('blocked'))}>
                {readiness.summary.blockingCount} blockers
              </span>
            )}
            {readiness.summary.warningCount > 0 && (
              <span className={cn('font-medium', statusIcon('review'))}>
                {readiness.summary.warningCount} warnings
              </span>
            )}
            <ChevronDown className='h-4 w-4 text-muted-foreground' />
          </span>
        </button>
      </section>
    )
  }

  return (
    <section className='rounded-md border bg-card p-4 shadow-[var(--shadow-card)]'>
      <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
        <div className='min-w-0 space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <ListChecks className='h-4 w-4 text-primary' />
            <h3 className='text-base font-semibold text-foreground'>
              Setup Readiness
            </h3>
            {gateBadges.map((gate) => (
              <Badge
                key={gate.key}
                variant='outline'
                className={cn('gap-1', statusBadge(gate.tone))}
              >
                <gate.icon className='h-3.5 w-3.5' />
                {gate.label}
              </Badge>
            ))}
            {onCollapsedChange && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='ms-auto h-7 gap-1 px-2 text-xs text-muted-foreground'
                onClick={() => onCollapsedChange(true)}
                data-testid='uat-setup-readiness-collapse'
              >
                Collapse
                <ChevronUp className='h-3.5 w-3.5' />
              </Button>
            )}
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
            <span>
              Checked {new Date(readiness.checkedAt).toLocaleString()}
            </span>
          </div>

          <div className='h-2 max-w-xl overflow-hidden rounded-full bg-muted'>
            <div
              className={cn(
                'h-2 rounded-full transition-all',
                progressGate.ready ? 'bg-success' : 'bg-interactive'
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
