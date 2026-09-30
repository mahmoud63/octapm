import type { ReactNode } from 'react'
import {
  ArrowRight,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  GitBranch,
  Link2,
} from 'lucide-react'
import { eacIsBudgetFallback } from '@/lib/eac-basis'
import { evCutoffNote, formatEvCutoff, type EvCutoff } from '@/lib/ev-cutoff'
import { useCanPerform } from '@/lib/permissions'
import { statusBadge, statusIcon, type StatusTone } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useCostSummary } from '@/features/cost/hooks/use-cost'
import { eacStatement, useForecast } from '@/features/forecast/hooks/use-forecast'
import { useProjectHealth } from '../hooks/use-project-health'
import type { ProjectSetupReadiness, ProjectSetupTarget } from '../data/schema'
import { noProgressActivitiesBadge, scheduleTileDetail } from '../lib/schedule-tile'

type Props = {
  projectId: string
  readiness?: ProjectSetupReadiness
  isLoading?: boolean
  currency?: string | null
  onNavigate: (target: ProjectSetupTarget) => void
  /**
   * Whether this person is offered the page a target opens. A tile or
   * figure whose page is not offered is drawn without its link — never an
   * active button that does nothing when pressed.
   */
  canNavigate?: (target: ProjectSetupTarget) => boolean
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
 * it: a source fact, a value derived from source rows, or a projection —
 * and, for the estimate at completion, the budget handed back when nothing
 * projects it (no CPI, or CPI 0), which is not a projection, or no figure
 * at all.
 */
type Truth = 'source' | 'derived' | 'projection' | 'fallback' | 'none'

const truthLabel: Record<Truth, string> = {
  source: 'source',
  derived: 'derived',
  projection: 'projection',
  fallback: 'budget fallback',
  none: 'no figure',
}

/** The server's sentence when the EV cutoff is still ahead (utils/ev-notes). */
const CUTOFF_NOT_REACHED_PREFIX = "This period's cutoff has not been reached"

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
  /** Absent when the page it would open is not offered to this person. */
  onClick?: () => void
}) {
  const Root = onClick ? 'button' : 'div'
  return (
    <Root
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      data-testid={testId}
      data-tone={tone}
      data-inert={onClick ? undefined : 'true'}
      title={title}
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-md border bg-card px-3 py-2 text-start',
        onClick &&
          'transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      )}
    >
      <span className='truncate text-[11px] font-medium text-muted-foreground'>{label}</span>
      <span
        className={cn('octa-numeric truncate text-base font-semibold', statusIcon(tone))}
        data-testid={`${testId}-value`}
      >
        {value}
      </span>
      {/* The basis wraps: it says what the figure is, so none of it is cut. */}
      <span
        className='text-[10px] leading-snug break-words text-muted-foreground'
        data-testid={`${testId}-basis`}
      >
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
    </Root>
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

/** Today, as the reader's calendar has it: the ledger's figures are as of now. */
function formatToday() {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date())
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
  /** Absent when the page it would open is not offered to this person. */
  onClick?: () => void
  testId: string
}) {
  const Root = onClick ? 'button' : 'div'
  return (
    <Root
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      data-testid={testId}
      data-inert={onClick ? undefined : 'true'}
      className={cn(
        'group flex min-w-0 flex-col justify-between gap-2 rounded-md border bg-card p-3 text-start shadow-[var(--shadow-card)]',
        onClick &&
          'transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      )}
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
      {onClick ? (
        <span className='inline-flex items-center gap-1 text-[11px] font-medium text-primary'>
          {action}
          <ArrowRight className='h-3 w-3 transition-transform group-hover:translate-x-0.5' />
        </span>
      ) : null}
    </Root>
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
  canNavigate = () => true,
  permissionsSettling = false,
}: Props) {
  // A tile's link, or none when its page is not offered to this person.
  const linkTo = (target: ProjectSetupTarget) =>
    canNavigate(target) ? () => onNavigate(target) : undefined
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
  // The health card's earned-value cutoff (the same query the card below
  // makes, shared through the cache): the strip's ledger figures are stated
  // against it, so nobody reads the two actual costs as one.
  const { data: health } = useProjectHealth<{
    dataFreshness?: {
      cutoffDate?: string | null
      cutoffLocalDate?: string | null
      cutoffTimeZone?: string | null
      cutoffTimeZoneNote?: string | null
      cutoffNotReachedNote?: string | null
    }
  }>(
    projectId,
    { enabled: !permissionsSettling }
  )

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
  // not read the BOQ — and the mapping's share and row counts with them
  // (owner decision C): the strip then says the details are unavailable,
  // it never shows a figure it was not given.
  const coverageWithheld = Boolean(coverage?.withheld)
  const coverageValuesShown = coverage?.totalBoqAmount != null
  // No bill yet (R6, the R5-4 family): the mapping's share and its row
  // counts are figures of nothing — the engine says they wait for the BOQ,
  // and the tiles read "—" with its words, never "0%" or "0".
  const mappingWaiting = Boolean(summary.mappingWaiting)
  const mappingWaitingText = summary.mappingReason ?? 'Waiting for the BOQ'
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
  // A member who may not read the BOQ is given no count of its rows: whether
  // a bill exists is read from the upload step's NO_BOQ blocker instead.
  const boqUploadStep = readiness.steps.find((step) => step.key === 'boq_upload')
  const boqRowCount = stepCounts('boq_upload').boqItems
  const boqRowsWithheld = Boolean(boqUploadStep) && boqRowCount === undefined
  const boqItems = Number(boqRowCount ?? 0)
  const hasBill = boqRowsWithheld
    ? !(boqUploadStep?.blockers ?? []).some((blocker) => blocker.code === 'NO_BOQ')
    : boqItems > 0
  const boqValue = boqRevision
    ? `Rev ${boqRevision.revisionNumber}`
    : hasBill
      ? boqRowsWithheld
        ? 'Entered by hand'
        : `${boqItems.toLocaleString()} rows`
      : 'No BOQ'
  const boqBadge = boqLocked
    ? 'Locked'
    : boqRevision
      ? (boqStatusLabel[boqRevision.status] ?? boqRevision.status)
      : hasBill
        ? 'Not reviewed'
        : 'Missing'
  const boqTone: StatusTone = boqLocked
    ? 'done'
    : boqRevision && ['approved', 'baselined'].includes(boqRevision.status)
      ? 'done'
      : hasBill
        ? 'review'
        : 'blocked'

  // Coverage (PC-3): approved allocations over the allocatable value; the
  // not-applicable bucket is neither covered nor uncovered.
  const coveragePct = coverage?.coveragePct ?? null
  const counts = coverage?.counts
  const coverageTone: StatusTone =
    coverageWithheld || mappingWaiting || coveragePct == null || coverage?.totalBoqAmount === 0
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
  // Activities entered or imported without a revision are a schedule too:
  // "No schedule" is for a project with no activities at all.
  const scheduleValue = scheduleRevision
    ? (scheduleStatusLabel[scheduleRevision.status] ?? scheduleRevision.status)
    : activities > 0
      ? `${activities.toLocaleString()} ${activities === 1 ? 'activity' : 'activities'}`
      : 'No schedule'
  const scheduleTone: StatusTone = baselineLocked
    ? 'done'
    : scheduleRevision?.status === 'approved'
      ? 'info'
      : scheduleRevision || activities > 0
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

  // The figures (§20): budget and actual as the cost summary states them;
  // the forecast at completion, critical, unmapped, over-allocated and
  // data-quality counts as the readiness check and the forecast already
  // report them. Nothing here is computed a second time, and the projection
  // says it is one.
  //
  // Their basis is said beside each: the budget register and the cost
  // ledger as of today; the forecast at completion through the earned-value
  // cutoff. An empty register or an empty ledger is not a figure: it reads
  // "—" with the reason, never 0 presented as a budget or a projection.
  const register = costSummary?.budget
  const fromRegister = register?.source === 'budget_register'
  const registerEmpty =
    fromRegister && !Number(register?.revisedBudget) && !Number(register?.originalBudget)
  // The cost summary's total of the budgets on activities that have a cost
  // record — not the revised BAC (approved allocations plus revisions),
  // which the forecast states beside its EAC.
  const allocatedToActivities = register?.allocatedToActivities ?? costSummary?.totals.budget ?? null
  const budgetValue = registerEmpty
    ? null
    : (register?.revisedBudget ?? costSummary?.totals.budget ?? null)
  const hasLedger = (costSummary?.records?.length ?? 0) > 0
  const actualValue = hasLedger ? (costSummary?.totals.actual ?? null) : null
  // Forecast at completion (owner decision D2): the business-rule EAC —
  // revised BAC / CPI, or the revised BAC with no CPI, labelled "the budget
  // — no cost performance yet" — exactly the figure the Forecast tab shows,
  // read from the same answer (the official EV report's, which the forecast
  // carries). Its tone compares it with the revised BAC it was computed
  // from. The cost ledger's own EAC stays in the cost cockpit.
  const eac = eacStatement(forecast)
  const ledgerDate = formatToday()
  // The EV cutoff the EAC was measured through (the forecast's; the health
  // card below reports through the same one).
  const evCutoff: EvCutoff | null = forecast?.earnedValueCutoff?.cutoffDate
    ? forecast.earnedValueCutoff
    : health?.dataFreshness?.cutoffDate
      ? {
          cutoffDate: health.dataFreshness.cutoffDate,
          cutoffLocalDate: health.dataFreshness.cutoffLocalDate,
          timeZone: health.dataFreshness.cutoffTimeZone,
          timeZoneNote: health.dataFreshness.cutoffTimeZoneNote,
        }
      : null
  const evCutoffZoneNote = evCutoffNote(evCutoff)
  // The EV cutoff still ahead: PV runs to it while EV and AC stop at today,
  // so the forecast at completion and the health cards compare a future plan
  // with to-date work. The server says so; the strip shows it.
  const cutoffNotReachedNote =
    health?.dataFreshness?.cutoffNotReachedNote ??
    forecast?.dataQuality?.find((note) => note.startsWith(CUTOFF_NOT_REACHED_PREFIX)) ??
    null
  // What the forecast at completion is, in its tag: a projection only when
  // it is the revised budget ÷ CPI; the budget handed back otherwise.
  const eacFallback = eacIsBudgetFallback(forecast?.cost?.eacBasis)
  const eacTruth: Truth = !canSeeSchedule || eac.value == null ? 'none' : eacFallback ? 'fallback' : 'projection'
  // The revised budget the EAC was computed from (the forecast's bac), so
  // "the budget" names a figure on the page.
  const revisedBac = forecast?.cost?.bac ?? null
  const eacBasisText = !canSeeSchedule
    ? 'schedule module not offered'
    : eac.value != null && revisedBac != null
      ? `${eac.label} · revised budget ${formatMoney(currency, revisedBac)}`
      : eac.label
  // The server's reason CPI is missing or 0, said with the figure.
  const cpiNote = forecast?.dataQuality?.find((note) => note.startsWith('CPI ')) ?? null
  const eacTitle = canSeeSchedule
    ? [
        eac.value == null
          ? `Forecast at completion: ${eac.label}.`
          : eacFallback
            ? `Forecast at completion: ${eac.label} — the revised budget${revisedBac != null ? ` (${formatMoney(currency, revisedBac)})` : ''} handed back, not a projection.`
            : `Forecast at completion: ${eac.label}${revisedBac != null ? ` (revised budget ${formatMoney(currency, revisedBac)})` : ''}, the official earned-value estimate.`,
        cpiNote,
        cutoffNotReachedNote,
        'The Forecast tab states the same figure.',
      ]
        .filter(Boolean)
        .join('\n')
    : undefined
  const criticalActivities = Number(stepCounts('schedule_generation').criticalActivities ?? 0)
  // How many critical activities have no approved allocation is read off
  // the mapping: a member who may not read the BOQ is not given it (the
  // server says so), and the tile says the details are unavailable — the
  // critical activities themselves are the schedule's and stay.
  const criticalUnmappedWithheld = Boolean(summary.criticalUnmappedWithheld)
  const criticalUnmapped = criticalUnmappedWithheld ? null : (summary.criticalUnmappedActivities ?? null)
  // No schedule, or one imported and not activated yet (R5-4): nothing has
  // been assessed, so neither figure is a fact — the tile reads "—" with the
  // server's words ("Waiting for active schedule"), never 0. The state is
  // the engine's; an answer that does not say it is read as before.
  const scheduleState = summary.scheduleState ?? null
  const criticalWaiting =
    Boolean(summary.criticalUnmappedWaiting) || scheduleState === 'none' || scheduleState === 'staged'
  const criticalWaitingText = summary.criticalUnmappedWaiting
    ? (summary.criticalUnmappedReason ?? 'Waiting for active schedule')
    : 'Waiting for active schedule'
  const unmappedRows = counts && !coverageWithheld && !mappingWaiting ? counts.unmapped + counts.partial : null
  const overAllocatedRows = coverageWithheld ? null : (counts?.over ?? null)
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
        onClick={linkTo(nextAction?.target ?? TARGETS.overview)}
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
                boqRevision.itemCount != null
                  ? `${boqRevision.itemCount.toLocaleString()} rows`
                  : (boqRevision.reason ?? 'BOQ details unavailable to you'),
                boqRevision.totalAmount != null && formatMoney(currency, boqRevision.totalAmount),
                boqRevision.label,
              ]
                .filter(Boolean)
                .join(' · ')
            : hasBill
              ? 'Entered by hand; approved when the schedule baseline is locked'
              : 'Upload the bill to start'
        }
        action='Open BOQ'
        onClick={linkTo(TARGETS.boq)}
        testId='uat-controls-boq'
      />
      <Tile
        icon={Link2}
        label='Allocation coverage'
        value={coverageWithheld || mappingWaiting ? '—' : formatPct(coveragePct)}
        valueTestId='uat-controls-coverage-pct'
        tone={coverageTone}
        badge={
          coverageWithheld
            ? 'Unavailable'
            : mappingWaiting
              ? mappingWaitingText
              : counts
              ? `${counts.complete} of ${counts.complete + counts.partial + counts.unmapped} rows covered`
              : 'No bill'
        }
        detail={
          coverageWithheld ? (
            <span data-testid='uat-controls-coverage-withheld'>
              {coverage?.reason ?? 'Mapping details unavailable to you'}
            </span>
          ) : mappingWaiting ? (
            <span data-testid='uat-controls-coverage-waiting'>{mappingWaitingText}</span>
          ) : !coverageValuesShown ? (
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
        onClick={linkTo(TARGETS.mapping)}
        testId='uat-controls-coverage'
      />
      <Tile
        icon={GitBranch}
        label='Schedule'
        value={scheduleValue}
        valueTestId='uat-controls-schedule'
        tone={scheduleTone}
        badge={baselineLocked ? 'Baseline locked' : gates.baseline.ready ? 'Baseline ready' : 'No baseline'}
        // The engine's state and its verdict on a staged revision, in the
        // tile's words (lib/schedule-tile.ts): "waiting for activation" only
        // for a revision the engine passes — a rejected or empty one is said
        // as that, as the headline beside it says FAIL.
        detail={scheduleTileDetail(readiness)}
        action={scheduleRevision || activities === 0 ? 'Open revisions' : 'Create a revision'}
        onClick={linkTo(TARGETS.revisions)}
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
            ? noProgressActivitiesBadge(readiness)
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
        onClick={linkTo(TARGETS.progress)}
        testId='uat-controls-methods'
      />
    </section>

    {/* What the figures below are measured against: the cost figures are
        the register's and the ledger's as of today; the health cards under
        the checklist report earned value through the reporting cutoff. */}
    {(canSeeCost || canSeeSchedule) && (
      <p className='text-[11px] text-muted-foreground' data-testid='uat-controls-figures-basis'>
        {canSeeCost && (
          <>
            Budget and actual: budget register and cost ledger as of{' '}
            <span data-testid='uat-controls-ledger-date'>{ledgerDate}</span>.{' '}
          </>
        )}
        {evCutoff ? (
          <>
            Forecast at completion and the health cards: earned value through the cutoff,{' '}
            <span data-testid='uat-controls-ev-cutoff'>{formatEvCutoff(evCutoff)}</span>.
            {evCutoffZoneNote ? (
              <>
                {' '}
                <span data-testid='uat-controls-ev-cutoff-zone-note'>{evCutoffZoneNote}.</span>
              </>
            ) : null}
            {cutoffNotReachedNote ? (
              <>
                {' '}
                <span
                  className='font-medium text-warning'
                  data-testid='uat-controls-ev-cutoff-not-reached'
                >
                  {cutoffNotReachedNote}
                </span>
              </>
            ) : null}
          </>
        ) : null}
      </p>
    )}
    <section
      className='grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8'
      data-testid='uat-controls-figures'
      aria-label='Project controls figures'
    >
      <Figure
        label='Budget'
        value={canSeeCost ? formatMoney(currency, budgetValue) : '—'}
        truth={fromRegister ? 'source' : 'derived'}
        basis={
          !canSeeCost
            ? 'cost module not offered'
            : registerEmpty
              ? `no budget register yet${
                  allocatedToActivities
                    ? ` · ${formatMoney(currency, allocatedToActivities)} in budgets of activities with cost records`
                    : ''
                }`
              : fromRegister
                ? 'budget register, revised'
                : costSummary?.activityBudgetsWithheld
                  ? `activity budgets · ${costSummary.activityBudgetsReason ?? 'Mapping details unavailable to you'}`
                  : 'activity budgets'
        }
        testId='uat-controls-figure-budget'
        onClick={linkTo(TARGETS.budget)}
      />
      <Figure
        label='Actual'
        value={canSeeCost ? formatMoney(currency, actualValue) : '—'}
        truth='derived'
        basis={
          !canSeeCost
            ? 'cost module not offered'
            : !hasLedger
              ? 'no cost records yet'
              : `cost ledger as of ${ledgerDate}`
        }
        testId='uat-controls-figure-actual'
        onClick={linkTo(TARGETS.cost)}
      />
      <Figure
        label='Forecast at completion'
        value={canSeeSchedule ? formatMoney(currency, eac.value) : '—'}
        truth={eacTruth}
        basis={eacBasisText}
        title={eacTitle}
        tone={eac.over ? 'review' : 'neutral'}
        testId='uat-controls-figure-forecast'
        // The Forecast tab shows this figure with this label.
        onClick={linkTo(TARGETS.forecast)}
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
        onClick={linkTo(TARGETS.progress)}
      />
      <Figure
        label='Critical activities'
        value={criticalWaiting ? '—' : criticalActivities.toLocaleString()}
        truth={criticalWaiting ? 'none' : 'derived'}
        basis={
          criticalWaiting
            ? criticalWaitingText
            : criticalUnmappedWithheld
              ? `on the critical path · ${summary.criticalUnmappedReason ?? 'Mapping details unavailable to you'}`
              : criticalUnmapped != null && criticalUnmapped > 0
                ? `${criticalUnmapped.toLocaleString()} without an approved allocation`
                : 'on the critical path'
        }
        tone={!criticalWaiting && criticalUnmapped != null && criticalUnmapped > 0 ? 'review' : 'neutral'}
        testId='uat-controls-figure-critical'
        onClick={linkTo(TARGETS.critical)}
      />
      <Figure
        label='Unmapped items'
        value={unmappedRows == null ? '—' : unmappedRows.toLocaleString()}
        truth={mappingWaiting ? 'none' : 'derived'}
        basis={
          coverageWithheld
            ? 'Mapping details unavailable to you'
            : mappingWaiting
              ? mappingWaitingText
              : counts
                ? `${counts.unmapped.toLocaleString()} unmapped · ${counts.partial.toLocaleString()} partial`
                : 'no bill yet'
        }
        tone={unmappedRows != null && unmappedRows > 0 ? 'review' : 'neutral'}
        testId='uat-controls-figure-unmapped'
        onClick={linkTo(TARGETS.mapping)}
      />
      <Figure
        label='Quantity exceptions'
        value={overAllocatedRows == null ? '—' : overAllocatedRows.toLocaleString()}
        truth='derived'
        basis={coverageWithheld ? 'Mapping details unavailable to you' : 'rows allocated over their quantity'}
        tone={overAllocatedRows != null && overAllocatedRows > 0 ? 'blocked' : 'neutral'}
        testId='uat-controls-figure-exceptions'
        onClick={linkTo(TARGETS.mapping)}
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
        onClick={linkTo(TARGETS.forecast)}
      />
    </section>
    </div>
  )
}
