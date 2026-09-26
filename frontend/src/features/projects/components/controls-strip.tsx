import type { ReactNode } from 'react'
import {
  ArrowRight,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  GitBranch,
  Link2,
} from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { statusBadge, statusIcon, type StatusTone } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useCostSummary } from '@/features/cost/hooks/use-cost'
import { useForecast } from '@/features/forecast/hooks/use-forecast'
import type { ProjectSetupReadiness, ProjectSetupTarget } from '../data/schema'

type Props = {
  projectId: string
  readiness?: ProjectSetupReadiness
  isLoading?: boolean
  currency?: string | null
  onNavigate: (target: ProjectSetupTarget) => void
  /**
   * True until this person's permission matrix for the project has arrived.
   * Until then useCanPerform answers from the role alone, and a template may
   * still take cost or schedule away, so no figure request is fired.
   */
  permissionsSettling?: boolean
}

const TARGETS = {
  boq: { module: 'boq' },
  mapping: { module: 'controls', child: 'mapping' },
  revisions: { module: 'schedule', child: 'revisions' },
  progress: { module: 'schedule', child: 'progress' },
  overview: { module: 'overview' },
  cost: { module: 'cost', child: 'overview' },
  budget: { module: 'cost', child: 'budget' },
  forecast: { module: 'schedule', child: 'forecast' },
  critical: { module: 'schedule', child: 'critical' },
} satisfies Record<string, ProjectSetupTarget>

/**
 * Which of the three truths a figure is (control model §3), said next to
 * it: a source fact, a value derived from source rows, or a projection.
 */
type Truth = 'source' | 'derived' | 'projection'

const truthLabel: Record<Truth, string> = {
  source: 'source',
  derived: 'derived',
  projection: 'projection',
}

/** One figure on the second row: label, value, its truth and where it lives. */
function Figure({
  label,
  value,
  truth,
  basis,
  tone = 'neutral',
  testId,
  title,
  onClick,
}: {
  label: string
  value: string
  truth: Truth
  basis: string
  tone?: StatusTone
  testId: string
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      title={title}
      className='flex min-w-0 flex-col gap-0.5 rounded-md border bg-card px-3 py-2 text-start transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      <span className='truncate text-[11px] font-medium text-muted-foreground'>{label}</span>
      <span
        className={cn('octa-numeric truncate text-base font-semibold', statusIcon(tone))}
        data-testid={`${testId}-value`}
      >
        {value}
      </span>
      <span className='truncate text-[10px] text-muted-foreground'>
        <span
          className={cn(
            'me-1 rounded-sm px-1 py-px font-semibold tracking-wide uppercase',
            truth === 'projection' ? 'bg-warning/15 text-warning' : 'bg-muted'
          )}
          data-testid={`${testId}-truth`}
        >
          {truthLabel[truth]}
        </span>
        {basis}
      </span>
    </button>
  )
}

const boqStatusLabel: Record<string, string> = {
  imported: 'Uploaded',
  comparison_only: 'Comparison only',
  under_review: 'Under review',
  approved: 'Approved',
  baselined: 'Baselined',
  superseded: 'Superseded',
}

const scheduleStatusLabel: Record<string, string> = {
  draft: 'Draft',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  baselined: 'Baselined',
  superseded: 'Superseded',
}

const methodLabel: Record<string, string> = {
  percent: 'percent',
  quantity: 'quantity',
  milestone: 'milestone',
}

function formatMoney(currency: string | null | undefined, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${currency ? `${currency} ` : ''}${Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value)}%`
}

function Tile({
  icon: Icon,
  label,
  value,
  valueTestId,
  tone,
  badge,
  detail,
  action,
  onClick,
  testId,
}: {
  icon: typeof Gauge
  label: string
  value: string
  valueTestId?: string
  tone: StatusTone
  badge: string
  detail: ReactNode
  action: string
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      className='group flex min-w-0 flex-col justify-between gap-2 rounded-md border bg-card p-3 text-start shadow-[var(--shadow-card)] transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      <div className='flex items-start justify-between gap-2'>
        <span className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
          <Icon className={cn('h-3.5 w-3.5', statusIcon(tone))} />
          {label}
        </span>
        <Badge variant='outline' className={cn('shrink-0 px-1.5 py-0 text-[11px]', statusBadge(tone))}>
          {badge}
        </Badge>
      </div>
      <div className='octa-numeric text-xl font-semibold text-foreground' data-testid={valueTestId}>
        {value}
      </div>
      <div className='text-[11px] leading-snug text-muted-foreground'>{detail}</div>
      <span className='inline-flex items-center gap-1 text-[11px] font-medium text-primary'>
        {action}
        <ArrowRight className='h-3 w-3 transition-transform group-hover:translate-x-0.5' />
      </span>
    </button>
  )
}

/**
 * The project-controls strip on the Overview landing (L3, workspace
 * switching doc §7): setup readiness, the bill's revision, allocation
 * coverage with its not-applicable bucket, the schedule's revision and
 * baseline, and the progress methods in use.
 *
 * Every figure comes from the readiness check, which reads the derived
 * services (PC-3's coverage summary, the schedule readiness) and computes
 * none of them again — three truths: what is shown here is the same number
 * the module pages show, and nothing on this strip is stored.
 */
export function ControlsStrip({
  projectId,
  readiness,
  isLoading,
  currency,
  onNavigate,
  permissionsSettling = false,
}: Props) {
  // The money figures come from the cost summary (budget register, ledger
  // projections, EAC) and the forecast service, read only when the policy
  // lets this person open those modules: a hidden module never fires the
  // request it would be refused (Phase 22B) — and nothing is asked before
  // the permission matrix has settled, since until then the answer is the
  // role's, which a template may narrow. The hooks take an empty id to stay
  // idle. Role shapes what shows; the API decides what is allowed.
  const canSeeCost = useCanPerform('cost', 'read') && !permissionsSettling
  const canSeeSchedule = useCanPerform('schedule', 'read') && !permissionsSettling
  const { data: costSummary } = useCostSummary(canSeeCost ? projectId : '')
  const { data: forecast } = useForecast(projectId, canSeeSchedule)

  if (isLoading && !readiness) {
    return (
      <section className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5' data-testid='uat-controls-strip'>
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className='h-28 animate-pulse rounded-md border bg-muted/40' />
        ))}
      </section>
    )
  }
  if (!readiness) return null

  const { summary, gates, coverage, context } = readiness
  // The readiness check leaves the bill's values out for a person who may
  // not read the BOQ; the strip then shows the shares and counts only.
  const coverageValuesShown = coverage?.totalBoqAmount != null
  const nextAction = summary.nextAction ?? summary.advisoryAction ?? null
  const stepCounts = (key: string) =>
    (readiness.steps.find((step) => step.key === key)?.counts ?? {}) as Record<string, unknown>

  // Setup readiness: the share of the twelve steps done, coloured by the
  // worst thing in the way.
  const readinessPct =
    summary.totalSteps > 0 ? Math.round((summary.completeSteps / summary.totalSteps) * 100) : 0
  const readinessTone: StatusTone =
    summary.blockingCount > 0 ? 'blocked' : summary.warningCount > 0 ? 'review' : 'done'

  // The bill: its current revision and whether the baseline is locked. A
  // bill entered by hand has rows but no revision.
  const boqRevision = context?.boqRevision ?? null
  const boqLocked = Boolean(context?.boqBaseline?.locked)
  const boqItems = Number(stepCounts('boq_upload').boqItems ?? 0)
  const boqValue = boqRevision
    ? `Rev ${boqRevision.revisionNumber}`
    : boqItems > 0
      ? `${boqItems.toLocaleString()} rows`
      : 'No BOQ'
  const boqBadge = boqLocked
    ? 'Locked'
    : boqRevision
      ? (boqStatusLabel[boqRevision.status] ?? boqRevision.status)
      : boqItems > 0
        ? 'Not reviewed'
        : 'Missing'
  const boqTone: StatusTone = boqLocked
    ? 'done'
    : boqRevision && ['approved', 'baselined'].includes(boqRevision.status)
      ? 'done'
      : boqItems > 0
        ? 'review'
        : 'blocked'

  // Coverage (PC-3): approved allocations over the allocatable value; the
  // not-applicable bucket is neither covered nor uncovered.
  const coveragePct = coverage?.coveragePct ?? null
  const counts = coverage?.counts
  const coverageTone: StatusTone =
    coveragePct == null || coverage?.totalBoqAmount === 0
      ? 'neutral'
      : coveragePct >= 99.995
        ? 'done'
        : coveragePct > 0
          ? 'review'
          : 'blocked'

  // Schedule: the revision under review and the baseline.
  const scheduleRevision = context?.currentRevision ?? null
  const baselineLocked = gates.baseline.alreadyLocked
  const activities = Number(stepCounts('schedule_generation').activeActivities ?? 0)
  const scheduleValue = scheduleRevision
    ? (scheduleStatusLabel[scheduleRevision.status] ?? scheduleRevision.status)
    : 'No schedule'
  const scheduleTone: StatusTone = baselineLocked
    ? 'done'
    : scheduleRevision?.status === 'approved'
      ? 'info'
      : scheduleRevision
        ? 'review'
        : 'blocked'

  // Progress methods: configured against the activities that progress.
  const methods = context?.progressMethods
  const byMethod = Object.entries(methods?.byMethod ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([method, count]) => `${count} ${methodLabel[method] ?? method}`)
  const methodsTone: StatusTone =
    !methods || methods.total === 0
      ? 'neutral'
      : methods.configured >= methods.total
        ? methods.quantityWithoutUnit > 0
          ? 'review'
          : 'done'
        : 'review'

  // The figures (§20): budget, actual and forecast as the cost summary
  // states them; critical, unmapped, over-allocated and data-quality counts
  // as the readiness check and the forecast already report them. Nothing
  // here is computed a second time, and the projection says it is one.
  const register = costSummary?.budget
  const budgetValue = register?.revisedBudget ?? costSummary?.totals.budget ?? null
  const actualValue = costSummary?.totals.actual ?? null
  const eacValue = costSummary?.eac?.mostLikely ?? null
  const criticalActivities = Number(stepCounts('schedule_generation').criticalActivities ?? 0)
  const criticalUnmapped = summary.criticalUnmappedActivities ?? null
  const unmappedRows = counts ? counts.unmapped + counts.partial : null
  const overAllocatedRows = counts?.over ?? null
  const dataQuality = forecast?.dataQuality ?? []
  const forecastCounts = forecast?.schedule?.counts ?? null
  const progressValue = forecastCounts
    ? `${forecastCounts.complete.toLocaleString()}/${forecastCounts.activities.toLocaleString()}`
    : '—'

  return (
    <div className='space-y-3' data-testid='uat-controls-strip-wrap'>
    <section
      className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'
      data-testid='uat-controls-strip'
      aria-label='Project controls summary'
    >
      <Tile
        icon={Gauge}
        label='Setup readiness'
        value={formatPct(readinessPct)}
        valueTestId='uat-controls-readiness-pct'
        tone={readinessTone}
        badge={
          summary.blockingCount > 0
            ? `${summary.blockingCount} blocking`
            : summary.warningCount > 0
              ? `${summary.warningCount} warnings`
              : 'Clear'
        }
        detail={
          <>
            <span className='octa-numeric'>
              {summary.completeSteps}/{summary.totalSteps}
            </span>{' '}
            steps complete · derived check, not stored
          </>
        }
        action={nextAction ? nextAction.label : 'Review setup'}
        onClick={() => onNavigate(nextAction?.target ?? TARGETS.overview)}
        testId='uat-controls-readiness'
      />
      <Tile
        icon={FileSpreadsheet}
        label='BOQ revision'
        value={boqValue}
        valueTestId='uat-controls-boq-revision'
        tone={boqTone}
        badge={boqBadge}
        detail={
          boqRevision
            ? [
                `${boqRevision.itemCount.toLocaleString()} rows`,
                boqRevision.totalAmount != null && formatMoney(currency, boqRevision.totalAmount),
                boqRevision.label,
              ]
                .filter(Boolean)
                .join(' · ')
            : boqItems > 0
              ? 'Entered by hand; approved by locking the BOQ baseline'
              : 'Upload the bill to start'
        }
        action='Open BOQ'
        onClick={() => onNavigate(TARGETS.boq)}
        testId='uat-controls-boq'
      />
      <Tile
        icon={Link2}
        label='Allocation coverage'
        value={formatPct(coveragePct)}
        valueTestId='uat-controls-coverage-pct'
        tone={coverageTone}
        badge={
          counts
            ? `${counts.complete} of ${counts.complete + counts.partial + counts.unmapped} rows covered`
            : 'No bill'
        }
        detail={
          !coverageValuesShown ? (
            <span data-testid='uat-controls-coverage-values-withheld'>
              Values are shown to people who can open the BOQ
            </span>
          ) : (
          <>
            {formatMoney(currency, coverage?.approvedAllocatedAmount)} approved of{' '}
            {formatMoney(currency, coverage?.allocatableBoqAmount ?? coverage?.totalBoqAmount)}{' '}
            allocatable · N/A bucket{' '}
            <span data-testid='uat-controls-na-amount'>
              {formatMoney(currency, coverage?.notApplicableAmount ?? 0)}
            </span>
            {counts && counts.notApplicable > 0 ? ` (${counts.notApplicable} rows)` : ''}
          </>
          )
        }
        action='Open mapping'
        onClick={() => onNavigate(TARGETS.mapping)}
        testId='uat-controls-coverage'
      />
      <Tile
        icon={GitBranch}
        label='Schedule'
        value={scheduleValue}
        valueTestId='uat-controls-schedule'
        tone={scheduleTone}
        badge={baselineLocked ? 'Baseline locked' : gates.baseline.ready ? 'Baseline ready' : 'No baseline'}
        detail={
          scheduleRevision
            ? `${activities.toLocaleString()} activities${scheduleRevision.label ? ` · ${scheduleRevision.label}` : ''}${
                baselineLocked && scheduleRevision.baselinedAt
                  ? ` · locked ${new Date(scheduleRevision.baselinedAt).toLocaleDateString()}`
                  : ''
              }`
            : 'Generate or import a schedule'
        }
        action='Open revisions'
        onClick={() => onNavigate(TARGETS.revisions)}
        testId='uat-controls-schedule-tile'
      />
      <Tile
        icon={ClipboardCheck}
        label='Progress method'
        value={methods && methods.total > 0 ? `${methods.configured}/${methods.total}` : '—'}
        valueTestId='uat-controls-progress-method'
        tone={methodsTone}
        badge={
          !methods || methods.total === 0
            ? 'No activities'
            : methods.configured >= methods.total
              ? 'Configured'
              : 'Defaults in use'
        }
        detail={
          byMethod.length > 0
            ? `${byMethod.join(' · ')}${methods && methods.quantityWithoutUnit > 0 ? ` · ${methods.quantityWithoutUnit} without a unit` : ''}`
            : 'Activities measure progress by percent until a method is set'
        }
        action='Configure methods'
        onClick={() => onNavigate(TARGETS.progress)}
        testId='uat-controls-methods'
      />
    </section>

    <section
      className='grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8'
      data-testid='uat-controls-figures'
      aria-label='Project controls figures'
    >
      <Figure
        label='Budget'
        value={canSeeCost ? formatMoney(currency, budgetValue) : '—'}
        truth={register?.source === 'budget_register' ? 'source' : 'derived'}
        basis={
          !canSeeCost
            ? 'cost module not offered'
            : register?.source === 'budget_register'
              ? 'budget register, revised'
              : 'activity budgets'
        }
        testId='uat-controls-figure-budget'
        onClick={() => onNavigate(TARGETS.budget)}
      />
      <Figure
        label='Actual'
        value={canSeeCost ? formatMoney(currency, actualValue) : '—'}
        truth='derived'
        basis={canSeeCost ? 'cost ledger to date' : 'cost module not offered'}
        testId='uat-controls-figure-actual'
        onClick={() => onNavigate(TARGETS.cost)}
      />
      <Figure
        label='Forecast at completion'
        value={canSeeCost ? formatMoney(currency, eacValue) : '—'}
        truth='projection'
        basis={
          !canSeeCost
            ? 'cost module not offered'
            : costSummary?.eac?.basis === 'estimate_at_completion'
              ? 'actual + cost to complete'
              : 'most likely EAC'
        }
        tone={
          budgetValue != null && eacValue != null && eacValue > budgetValue ? 'review' : 'neutral'
        }
        testId='uat-controls-figure-forecast'
        onClick={() => onNavigate(TARGETS.forecast)}
      />
      <Figure
        label='Progress'
        value={canSeeSchedule ? progressValue : '—'}
        truth='derived'
        basis={
          !canSeeSchedule
            ? 'schedule module not offered'
            : forecastCounts
              ? `activities complete · ${forecastCounts.open.toLocaleString()} open`
              : forecast?.reason ?? 'no schedule yet'
        }
        testId='uat-controls-figure-progress'
        onClick={() => onNavigate(TARGETS.progress)}
      />
      <Figure
        label='Critical activities'
        value={criticalActivities.toLocaleString()}
        truth='derived'
        basis={
          criticalUnmapped != null && criticalUnmapped > 0
            ? `${criticalUnmapped.toLocaleString()} without an approved allocation`
            : 'on the critical path'
        }
        tone={criticalUnmapped != null && criticalUnmapped > 0 ? 'review' : 'neutral'}
        testId='uat-controls-figure-critical'
        onClick={() => onNavigate(TARGETS.critical)}
      />
      <Figure
        label='Unmapped items'
        value={unmappedRows == null ? '—' : unmappedRows.toLocaleString()}
        truth='derived'
        basis={
          counts
            ? `${counts.unmapped.toLocaleString()} unmapped · ${counts.partial.toLocaleString()} partial`
            : 'no bill yet'
        }
        tone={unmappedRows != null && unmappedRows > 0 ? 'review' : 'neutral'}
        testId='uat-controls-figure-unmapped'
        onClick={() => onNavigate(TARGETS.mapping)}
      />
      <Figure
        label='Quantity exceptions'
        value={overAllocatedRows == null ? '—' : overAllocatedRows.toLocaleString()}
        truth='derived'
        basis='rows allocated over their quantity'
        tone={overAllocatedRows != null && overAllocatedRows > 0 ? 'blocked' : 'neutral'}
        testId='uat-controls-figure-exceptions'
        onClick={() => onNavigate(TARGETS.mapping)}
      />
      <Figure
        label='Data-quality issues'
        value={canSeeSchedule && forecast ? dataQuality.length.toLocaleString() : '—'}
        truth='derived'
        basis={
          !canSeeSchedule
            ? 'schedule module not offered'
            : dataQuality.length > 0
              ? dataQuality[0]
              : 'forecast inputs are clean'
        }
        title={dataQuality.join('\n') || undefined}
        tone={dataQuality.length > 0 ? 'review' : 'neutral'}
        testId='uat-controls-figure-data-quality'
        onClick={() => onNavigate(TARGETS.forecast)}
      />
    </section>
    </div>
  )
}
