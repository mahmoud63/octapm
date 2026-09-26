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
import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { formatDateTime } from '@/lib/dates'
import { statusBadge, statusIcon, statusSolid, statusStripe } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ProjectSetupGuide,
  ProjectSetupHeadlineEntry,
  ProjectSetupIssue,
  ProjectSetupItem,
  ProjectSetupReadiness,
  ProjectSetupStep,
  ProjectSetupTarget,
} from '../data/schema'

type BoqRevisionContext = NonNullable<
  NonNullable<ProjectSetupReadiness['context']>['boqRevision']
>

type Props = {
  readiness?: ProjectSetupReadiness
  isLoading?: boolean
  /** The project's currency, for the bill's value on the approval card. */
  currency?: string | null
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
  revisionNumber: 'Revision',
  wbsNodes: 'WBS nodes',
  locations: 'Locations',
  projectCostCodes: 'Cost codes',
  unitsUnresolved: 'Units unknown',
  itemsWithoutMappingRule: 'No rule',
  baselineLocked: 'Locked',
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

/** How many issues a card lists, and how many records under each one. */
const ISSUES_SHOWN = 3
const ITEMS_SHOWN = 3

const severityTone = (issue: ProjectSetupIssue) =>
  issue.severity === 'blocking' ? ('blocked' as const) : ('review' as const)

/**
 * A link to the record behind an issue. A real anchor — the address is
 * visible and opens in a new tab — that the router follows in place: the
 * href already carries the project's workspace (`/o/{slug}/projects/…`).
 */
function ItemLink({ item }: { item: ProjectSetupItem }) {
  const navigate = useNavigate()
  const name = [item.code, item.label].filter(Boolean).join(' · ') || item.type
  return (
    <a
      href={item.href}
      data-testid={`uat-setup-item-${item.type}-${item.id ?? item.code ?? 'project'}`}
      className='inline-flex max-w-full items-baseline gap-1 text-xs text-foreground underline-offset-2 hover:underline'
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        void navigate({ href: item.href })
      }}
    >
      <span className='truncate font-medium'>{name}</span>
      <span className='shrink-0 text-muted-foreground'>— {item.missing}</span>
    </a>
  )
}

/**
 * One blocker or warning with the records behind it (PC-4): the first few
 * are linked, the rest are counted, and the step's own action opens the
 * module where the whole list lives.
 */
function IssueDetail({ issue }: { issue: ProjectSetupIssue }) {
  const items = issue.items ?? []
  const count = issue.count ?? items.length
  const shown = items.slice(0, ITEMS_SHOWN)
  const more = count - shown.length
  return (
    <li data-testid={`uat-setup-issue-${issue.code}`} className='space-y-1'>
      <div className='flex items-start gap-1.5'>
        <span
          aria-hidden
          className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusSolid(severityTone(issue)))}
        />
        <span className='text-xs text-muted-foreground'>
          {issue.message}
          {count > 0 && (
            <span className='octa-numeric ms-1 text-[11px]'>({count})</span>
          )}
        </span>
      </div>
      {shown.length > 0 && (
        <ul className='ms-3 space-y-0.5'>
          {shown.map((item, index) => (
            <li key={`${item.type}-${item.id ?? item.code ?? index}`} className='flex'>
              <ItemLink item={item} />
            </li>
          ))}
          {more > 0 && (
            <li className='text-[11px] text-muted-foreground'>and {more} more</li>
          )}
        </ul>
      )}
    </li>
  )
}

/**
 * A link that the router follows in place, with a real address for a new
 * tab: every href from the readiness check already carries the workspace.
 */
function RouterLink({
  href,
  className,
  testId,
  children,
}: {
  href: string
  className?: string
  testId?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <a
      href={href}
      data-testid={testId}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        void navigate({ href })
      }}
    >
      {children}
    </a>
  )
}

const guideTone = (guide: ProjectSetupGuide) =>
  guide.status === 'complete'
    ? ('done' as const)
    : guide.status === 'attention'
      ? ('review' as const)
      : ('neutral' as const)

/**
 * What the structure step guides (§21): WBS, locations, cost codes, BOQ
 * structure, schedule structure and mapping readiness — each a link to the
 * page where it is done, with what is still to file. The readiness check
 * derives every figure; this only lays them out.
 */
function GuideList({ guides }: { guides: ProjectSetupGuide[] }) {
  return (
    <ul className='space-y-1 border-t pt-2' data-testid='uat-setup-guides'>
      {guides.map((guide) => (
        <li key={guide.key} className='flex items-start gap-1.5'>
          <span
            aria-hidden
            className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusSolid(guideTone(guide)))}
          />
          <RouterLink
            href={guide.href}
            testId={`uat-setup-guide-${guide.key}`}
            className='inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs underline-offset-2 hover:underline'
          >
            <span className='font-medium text-foreground'>{guide.label}</span>
            <span className='text-muted-foreground'>— {guide.detail}</span>
          </RouterLink>
        </li>
      ))}
    </ul>
  )
}

const revisionStatusLabel: Record<string, string> = {
  imported: 'Uploaded',
  comparison_only: 'Comparison only',
  under_review: 'Under review',
  approved: 'Approved',
  baselined: 'Baselined',
  superseded: 'Superseded',
}

// The actions the approval workflow records on a BOQ revision
// (approval-workflow.service ACTIONS), as a person reads them.
const historyActionLabel: Record<string, string> = {
  imported: 'Uploaded',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  baseline_locked: 'Locked',
  superseded: 'Superseded',
}

const HISTORY_SHOWN = 3

function formatMoney(currency: string | null | undefined, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${currency ? `${currency} ` : ''}${Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`
}

/**
 * The bill's revision on the approval card (§22): revision, status, source,
 * rows and value, the upload's changes, the rows it could not apply, and
 * the review trail — the revision's own record as PC-2 keeps it, never a
 * second approval mechanism.
 */
function RevisionDetail({
  revision,
  currency,
}: {
  revision: BoqRevisionContext
  currency?: string | null
}) {
  const changes = revision.changes
  const blocked = revision.validation?.blocked ?? []
  const history = revision.history ?? []
  const shownHistory = history.slice(-HISTORY_SHOWN)
  return (
    <dl
      className='space-y-1 border-t pt-2 text-xs'
      data-testid='uat-setup-boq-revision'
    >
      <div className='flex flex-wrap items-baseline gap-x-2'>
        <dt className='sr-only'>Revision</dt>
        <dd className='font-medium text-foreground' data-testid='uat-setup-boq-revision-number'>
          Rev {revision.revisionNumber}
          {revision.label ? ` · ${revision.label}` : ''}
        </dd>
        <dd className='text-muted-foreground' data-testid='uat-setup-boq-revision-status'>
          {revision.baselineLocked
            ? 'Locked'
            : (revisionStatusLabel[revision.status] ?? revision.status)}
          {revision.source ? ` · ${revision.source}` : ''}
        </dd>
      </div>
      <div className='flex flex-wrap gap-x-2 text-muted-foreground'>
        <dt className='sr-only'>Scope</dt>
        <dd className='octa-numeric' data-testid='uat-setup-boq-revision-scope'>
          {revision.itemCount.toLocaleString()} rows · {formatMoney(currency, revision.totalAmount)}
        </dd>
        {changes && (
          <>
            <dt className='sr-only'>Changes</dt>
            <dd className='octa-numeric' data-testid='uat-setup-boq-revision-changes'>
              +{changes.added} added · {changes.updated} updated · −{changes.removed} removed
            </dd>
          </>
        )}
      </div>
      {blocked.length > 0 && (
        <div data-testid='uat-setup-boq-revision-validation'>
          <dt className={cn('font-medium', statusIcon('review'))}>
            {revision.validation?.blockedCount ?? blocked.length} row
            {(revision.validation?.blockedCount ?? blocked.length) === 1 ? '' : 's'} not applied
          </dt>
          {blocked.slice(0, 3).map((row, index) => (
            <dd key={`${row.code ?? index}`} className='truncate text-muted-foreground'>
              {[row.code, row.description].filter(Boolean).join(' · ')}
              {row.reason ? ` — ${row.reason}` : ''}
            </dd>
          ))}
        </div>
      )}
      {shownHistory.length > 0 && (
        <div data-testid='uat-setup-boq-revision-history'>
          <dt className='font-medium text-foreground'>Approval history</dt>
          {shownHistory.map((entry) => (
            <dd key={entry.id} className='truncate text-muted-foreground'>
              {historyActionLabel[entry.action] ?? entry.action}
              {entry.actorName ? ` by ${entry.actorName}` : ''}
              {entry.at ? ` · ${formatDateTime(entry.at)}` : ''}
              {entry.comment ? ` — ${entry.comment}` : ''}
            </dd>
          ))}
          {history.length > shownHistory.length && (
            <dd className='text-[11px] text-muted-foreground'>
              and {history.length - shownHistory.length} earlier
            </dd>
          )}
        </div>
      )}
    </dl>
  )
}

function StepCard({
  step,
  onNavigate,
  boqRevision,
  currency,
}: {
  step: ProjectSetupStep
  onNavigate: (target: ProjectSetupTarget) => void
  boqRevision?: BoqRevisionContext | null
  currency?: string | null
}) {
  const meta = statusMeta[step.status] ?? statusMeta.pending
  const Icon = meta.icon
  const chips = countChips(step)
  // Blockers first, then warnings; a card lists a few and counts the rest.
  const issues = [...step.blockers, ...step.warnings]
  const shownIssues = issues.slice(0, ISSUES_SHOWN)
  const moreIssues = issues.length - shownIssues.length

  return (
    // Status reads from a leading stripe and a badge, not from flooding the
    // card — the card stays a neutral surface so the content is legible.
    <div
      data-testid={`uat-setup-step-${step.key}`}
      className='relative flex min-h-35 flex-col justify-between overflow-hidden rounded-md border bg-card p-3 pl-3.5 shadow-[var(--shadow-card)]'
    >
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

        {step.guides && step.guides.length > 0 && <GuideList guides={step.guides} />}

        {step.key === 'boq_approval' && boqRevision && (
          <RevisionDetail revision={boqRevision} currency={currency} />
        )}

        {shownIssues.length > 0 && (
          <ul className='space-y-1.5 border-t pt-2' data-testid={`uat-setup-issues-${step.key}`}>
            {shownIssues.map((issue) => (
              <IssueDetail key={issue.code} issue={issue} />
            ))}
            {moreIssues > 0 && (
              <li className='text-[11px] text-muted-foreground'>
                and {moreIssues} more {moreIssues === 1 ? 'issue' : 'issues'}
              </li>
            )}
          </ul>
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

/**
 * The §33 status line: "BOQ imported PASS · Schedule imported PASS ·
 * Mapping 83% · …", each entry in the tone the check gave it. A person
 * reads this before the cards; a warning says proceed with care, a block
 * says a gate stands in the way.
 */
function Headline({ entries }: { entries: ProjectSetupHeadlineEntry[] }) {
  return (
    <ul
      className='flex flex-wrap items-center gap-x-1 gap-y-1 text-xs'
      data-testid='uat-setup-headline'
      aria-label='Setup status'
    >
      {entries.map((entry, index) => (
        <li key={entry.key} className='flex items-center gap-1' data-testid={`uat-setup-headline-${entry.key}`}>
          {index > 0 && <span aria-hidden className='text-muted-foreground'>·</span>}
          <span className='text-muted-foreground'>{entry.label}</span>
          <span className={cn('octa-numeric font-semibold', statusIcon(entry.tone))}>
            {entry.value}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ProjectSetupWizard({
  readiness,
  isLoading,
  currency,
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

          {readiness.summary.headline && readiness.summary.headline.length > 0 && (
            <Headline entries={readiness.summary.headline} />
          )}

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
          <StepCard
            key={step.key}
            step={step}
            onNavigate={onNavigate}
            boqRevision={readiness.context?.boqRevision ?? null}
            currency={currency}
          />
        ))}
      </div>
    </section>
  )
}
