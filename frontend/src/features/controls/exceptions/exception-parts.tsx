import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { formatQuantity } from '../lib/detail-format'
import type {
  ExceptionFigure,
  ExceptionSeverity,
  ExceptionStatus,
  ExceptionsWithheld,
  ProjectException,
  SeverityCounts,
} from './api'
import { SEVERITY_LABEL, SEVERITY_ORDER, STATUS_LABEL } from './exception-format'

/**
 * The pieces every exception surface is drawn from (the Exceptions screen,
 * the PC-5 drawers, the Overview strip, the workspace tile): the severity
 * chip, the status, the two figures each with its basis, and the withheld
 * note. A figure is printed as the server stated it — formatted, never
 * added, subtracted or divided: the gap between measured and limit is the
 * server's to state, not the browser's.
 */

const SEVERITY_CLASS: Record<ExceptionSeverity, string> = {
  critical: 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  warning: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

export function SeverityChip({
  severity,
  className,
}: {
  severity: ExceptionSeverity
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn('px-1.5 py-0 text-[10px] font-semibold uppercase', SEVERITY_CLASS[severity], className)}
      data-severity={severity}
    >
      {SEVERITY_LABEL[severity] ?? severity}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: ExceptionStatus }) {
  return (
    <Badge
      variant={status === 'open' ? 'secondary' : 'outline'}
      className='text-[10px]'
      data-status={status}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

/** One figure: the server's value in its unit, and the basis the owning service gave it. */
export function ExceptionFigureText({
  label,
  figure,
  testId,
}: {
  label: string
  figure: ExceptionFigure | null | undefined
  testId?: string
}) {
  return (
    <div className='min-w-0' data-testid={testId}>
      <span className='text-[11px] text-muted-foreground'>{label} </span>
      <span className='font-medium tabular-nums' data-value={figure?.value ?? ''}>
        {figure?.value == null ? '—' : formatQuantity(figure.value)}
        {figure?.value != null && figure.unitCode ? ` ${figure.unitCode}` : ''}
      </span>
      {figure?.basis && (
        <span className='block text-[10px] leading-snug text-muted-foreground' data-basis='true'>
          {figure.basis}
        </span>
      )}
    </div>
  )
}

/** Measured against limit, side by side: both as sent, nothing derived from the pair. */
export function MeasuredVsLimit({
  exception,
  testId,
}: {
  exception: Pick<ProjectException, 'measured' | 'limit'>
  testId?: string
}) {
  return (
    <div className='grid gap-1 text-sm sm:grid-cols-2' data-testid={testId}>
      <ExceptionFigureText label='Measured' figure={exception.measured} testId={testId ? `${testId}-measured` : undefined} />
      <ExceptionFigureText label='Limit' figure={exception.limit} testId={testId ? `${testId}-limit` : undefined} />
    </div>
  )
}

/**
 * The server withheld exceptions from this caller: a dash and its reason.
 * Never a count, never "no exceptions" — some exist that this person may
 * not read.
 */
export function WithheldNote({
  withheld,
  hasVisible,
  testId,
}: {
  withheld: ExceptionsWithheld
  hasVisible: boolean
  testId?: string
}) {
  return (
    <p
      className='text-sm text-muted-foreground'
      data-testid={testId}
      data-withheld='true'
      data-reason={withheld.reason}
    >
      — {hasVisible ? 'Some exceptions are not listed' : 'Exceptions withheld'}: {withheld.reason}
    </p>
  )
}

/** Per-severity counts as the server sent them; a severity it did not send is not drawn. */
export function SeverityCountChips({
  counts,
  testId,
}: {
  counts: SeverityCounts
  testId?: string
}) {
  const present = SEVERITY_ORDER.filter((severity) => typeof counts[severity] === 'number')
  if (!present.length) return null
  return (
    <span className='inline-flex flex-wrap items-center gap-1' data-testid={testId}>
      {present.map((severity) => (
        <span
          key={severity}
          className='inline-flex items-center gap-1 text-xs'
          data-testid={testId ? `${testId}-${severity}` : undefined}
          data-count={counts[severity]}
        >
          <SeverityChip severity={severity} />
          <span className='tabular-nums'>{counts[severity]!.toLocaleString()}</span>
        </span>
      ))}
    </span>
  )
}
