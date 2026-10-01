import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type {
  ControlsFigure,
  ControlsSectionDenied,
} from '@/features/boq/data/schema'
import { formatMoney, formatQuantity } from '../lib/detail-format'
import { OfficialInstalledNote } from '../quantities/official-installed'

/**
 * The pieces both detail drawers (PC-5) are drawn from, so a BOQ item and an
 * activity read as one story: the same figure with the same truth badge, the
 * same "withheld" line, the same link to where a related record lives.
 */

const TRUTH_LABEL: Record<string, string> = {
  source: 'Source',
  derived: 'Derived',
  projection: 'Projection',
}

const TRUTH_CLASS: Record<string, string> = {
  source: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  derived: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  projection: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
}

/** Which of the three truths a figure is (control model §3), with its basis on hover. */
export function TruthBadge({ figure }: { figure: ControlsFigure }) {
  if (!figure.truth) return null
  return (
    <Badge
      variant='outline'
      className={cn('px-1 py-0 text-[10px] font-medium', TRUTH_CLASS[figure.truth])}
      title={figure.basis}
      data-truth={figure.truth}
    >
      {TRUTH_LABEL[figure.truth]}
    </Badge>
  )
}

/**
 * One figure as the server proved it. A figure no service can prove yet says
 * so and names the wave that brings it; a missing one is a dash — never a 0
 * that would read as a fact.
 */
export function FigureRow({
  label,
  figure,
  format = 'quantity',
  currency = '',
  suffix = '',
  hint,
  testId,
}: {
  label: string
  figure: ControlsFigure | null | undefined
  format?: 'quantity' | 'money' | 'percent'
  currency?: string
  suffix?: string
  /** The label's one-line meaning (FINANCIAL_TERMS hint), on hover. */
  hint?: string
  testId?: string
}) {
  let body: ReactNode
  if (!figure) {
    body = <span className='text-muted-foreground'>—</span>
  } else if (figure.notAvailable) {
    // PC-5 names the wave that brings the figure; PC-6's quantity views name
    // the reason it is not available. Either way there is no number.
    const reason = typeof figure.notAvailable === 'object' ? figure.notAvailable.reason : null
    body = (
      <span className='text-xs text-muted-foreground' data-not-available={figure.wave ?? 'reason'} title={reason ?? undefined}>
        {reason ?? `Not available yet (${figure.wave})`}
      </span>
    )
  } else if (figure.withheld) {
    // The server withheld the figure: a dash — its reason is the basis below.
    body = (
      <span className='text-muted-foreground' data-withheld='true'>
        —
      </span>
    )
  } else {
    const text =
      format === 'money'
        ? formatMoney(currency, figure.value)
        : format === 'percent'
          ? `${formatQuantity(figure.value)}%`
          : `${formatQuantity(figure.value)}${suffix ? ` ${suffix}` : ''}`
    body = (
      <span className='inline-flex items-center gap-1.5'>
        {/* A default forecast says so (owner decision R5-2): never read as
            an entered one. Its basis is on hover and in the line below. */}
        {figure.forecastSource === 'default' && (
          <Badge
            variant='outline'
            className='border-dashed border-amber-500/50 px-1 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-300'
            title={figure.basis}
            data-forecast-source='default'
          >
            Default
          </Badge>
        )}
        <span className='font-medium tabular-nums' data-value={figure.value ?? ''}>
          {text}
        </span>
        <TruthBadge figure={figure} />
      </span>
    )
  }
  return (
    <div className='flex items-start justify-between gap-3 py-1 text-sm' data-testid={testId}>
      <div className='min-w-0'>
        <p className='text-muted-foreground' title={hint}>{label}</p>
        {figure && (
          <p className='text-[11px] leading-snug text-muted-foreground/80'>{figure.basis}</p>
        )}
        {/* PC-6: the official installed figure beside Σ approved entries,
            when the server states one (a legacy typed quantity carried as
            the floor) — never sent with a withheld figure. */}
        <OfficialInstalledNote
          official={figure?.officialInstalled}
          testId={`${testId ?? 'figure'}-official`}
        />
      </div>
      <div className='shrink-0 text-right'>{body}</div>
    </div>
  )
}

/** A section the server did not send: a dash and the server's reason. */
export function Withheld({
  section,
  testId,
}: {
  section: ControlsSectionDenied
  testId?: string
}) {
  return (
    <p
      className='text-sm text-muted-foreground'
      data-testid={testId}
      data-withheld-module={section.module}
    >
      — {section.reason}
    </p>
  )
}

export function DetailSection({
  title,
  children,
  testId,
}: {
  title: string
  children: ReactNode
  testId?: string
}) {
  return (
    <section className='space-y-2 rounded-md border p-3' data-testid={testId}>
      <h3 className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * A related record, linked to where it lives (a server-built /o/{slug}/…
 * path). Followed through the router, so the workspace stays loaded.
 */
export function RecordLink({
  href,
  children,
  testId,
  className,
}: {
  href: string | null | undefined
  children: ReactNode
  testId?: string
  className?: string
}) {
  const navigate = useNavigate()
  if (!href) {
    return (
      <span className={className} data-testid={testId} data-inert='true'>
        {children}
      </span>
    )
  }
  return (
    <a
      href={href}
      data-testid={testId}
      className={cn('inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline', className)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        void navigate({ href })
      }}
    >
      {children}
      <ExternalLink className='h-3 w-3 shrink-0' aria-hidden />
    </a>
  )
}

/** Opens the other drawer in place — the BOQ item from an activity, or back. */
export function DrawerLink({
  onClick,
  children,
  testId,
}: {
  onClick: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      className='inline-flex items-center gap-1 text-left font-medium text-primary underline-offset-2 hover:underline'
    >
      {children}
      <PanelRightOpen className='h-3 w-3 shrink-0' aria-hidden />
    </button>
  )
}

/** "12 of 60 — view all": a capped list says how many it left out, and where they are. */
export function CappedNote({
  shown,
  total,
  viewAll,
  testId,
}: {
  shown: number
  total: number
  viewAll?: string | null
  testId?: string
}) {
  if (total <= shown && !viewAll) return null
  return (
    <p className='text-xs text-muted-foreground'>
      {total > shown ? `${shown} of ${total} shown` : `${total} in all`}
      {viewAll ? (
        <>
          {' · '}
          <RecordLink href={viewAll} testId={testId}>
            View all
          </RecordLink>
        </>
      ) : null}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className='text-sm text-muted-foreground'>{children}</p>
}
