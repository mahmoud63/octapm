import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  CoverageGroup,
  CoverageGroupBy,
  CoverageSummary,
} from '../hooks/use-mapping'

/**
 * The §69 coverage figures for the whole bill and for the current grouping.
 *
 * BOQ total = approved allocated + unallocated + not applicable, so the three
 * bars of a row always add up to its value: the n/a share is neither covered
 * nor a gap. A row's coverage is the approved share of what must (or may) be
 * scheduled.
 */

type Props = {
  projectId: string
  summary: CoverageSummary | undefined
  isLoading: boolean
  groupBy: CoverageGroupBy
  currency: string
  selectedGroupKey: string | null
  onSelectGroup: (key: string | null) => void
}

const fmtMoney = (currency: string, value: number) =>
  `${currency} ${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`

const pct = (value: number) => `${Math.round(Number(value || 0))}%`

function CoverageBar({
  group,
  className,
}: {
  group: Pick<
    CoverageGroup,
    | 'totalBoqAmount'
    | 'approvedAllocatedAmount'
    | 'pendingAllocatedAmount'
    | 'unallocatedAmount'
    | 'notApplicableAmount'
  >
  className?: string
}) {
  const total = Math.max(group.totalBoqAmount, 0.01)
  const share = (value: number) => `${Math.min(100, (value / total) * 100)}%`
  return (
    <div
      className={cn(
        'flex h-2 w-full overflow-hidden rounded-full bg-muted',
        className
      )}
      title={`Approved ${pct((group.approvedAllocatedAmount / total) * 100)} · pending ${pct((group.pendingAllocatedAmount / total) * 100)} · unallocated ${pct((group.unallocatedAmount / total) * 100)} · n/a ${pct((group.notApplicableAmount / total) * 100)}`}
    >
      <div
        className='bg-emerald-500'
        style={{ width: share(group.approvedAllocatedAmount) }}
      />
      <div
        className='bg-amber-400'
        style={{ width: share(group.pendingAllocatedAmount) }}
      />
      <div
        className='bg-muted-foreground/30'
        style={{ width: share(group.notApplicableAmount) }}
      />
    </div>
  )
}

export function CoveragePanel({
  summary,
  isLoading,
  groupBy,
  currency,
  selectedGroupKey,
  onSelectGroup,
}: Props) {
  if (isLoading || !summary) {
    return (
      <div className='space-y-3 p-4' data-testid='uat-mapping-coverage'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-full' />
      </div>
    )
  }

  const tiles: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'BOQ total', value: fmtMoney(currency, summary.totalBoqAmount) },
    {
      label: 'Approved',
      value: fmtMoney(currency, summary.approvedAllocatedAmount),
      tone: 'text-emerald-600',
    },
    {
      label: 'Pending',
      value: fmtMoney(currency, summary.pendingAllocatedAmount),
      tone: 'text-amber-600',
    },
    {
      label: 'Unallocated',
      value: fmtMoney(currency, summary.unallocatedAmount),
      // Only what required rows still leave open blocks the baseline.
      tone:
        summary.unallocatedAmount - summary.optionalUnallocatedAmount > 0.01
          ? 'text-destructive'
          : undefined,
    },
    {
      label: 'Optional, unallocated',
      value: fmtMoney(currency, summary.optionalUnallocatedAmount),
      tone: 'text-amber-600',
    },
    {
      label: 'Not applicable',
      value: fmtMoney(currency, summary.notApplicableAmount),
      tone: 'text-muted-foreground',
    },
  ]

  return (
    <div className='space-y-4 p-4' data-testid='uat-mapping-coverage'>
      <div>
        <div className='flex items-baseline justify-between'>
          <h3 className='text-sm font-semibold'>Coverage</h3>
          <span
            className='text-lg font-semibold tabular-nums'
            data-testid='uat-mapping-coverage-pct'
          >
            {pct(summary.coveragePct)}
          </span>
        </div>
        <CoverageBar group={summary} className='mt-2 h-3' />
        <p className='mt-1 text-xs text-muted-foreground'>
          Approved share of {fmtMoney(currency, summary.allocatableBoqAmount)}{' '}
          allocatable
        </p>
      </div>

      <div className='grid grid-cols-2 gap-2 text-sm'>
        {tiles.map((tile) => (
          <div key={tile.label} className='rounded-md border px-3 py-2'>
            <p className='text-xs text-muted-foreground'>{tile.label}</p>
            <p className={cn('font-semibold tabular-nums', tile.tone)}>
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      <div className='flex flex-wrap gap-1 text-xs'>
        <Badge variant='outline'>{summary.counts.unmapped} unmapped</Badge>
        <Badge variant='outline'>{summary.counts.partial} partial</Badge>
        <Badge variant='outline'>{summary.counts.complete} complete</Badge>
        {summary.counts.over > 0 && (
          <Badge variant='destructive'>{summary.counts.over} over</Badge>
        )}
        <Badge variant='secondary'>{summary.counts.notApplicable} n/a</Badge>
      </div>

      {groupBy !== 'none' && (
        <div>
          <h4 className='mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            By {groupBy === 'costCode' ? 'cost code' : groupBy}
          </h4>
          {summary.groups.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              No rows carry this dimension yet.
            </p>
          ) : (
            <ul className='space-y-2'>
              {summary.groups.map((group) => {
                const selected = selectedGroupKey === group.key
                return (
                  <li key={group.key}>
                    <button
                      type='button'
                      onClick={() => onSelectGroup(selected ? null : group.key)}
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50',
                        selected && 'border-primary bg-primary/5'
                      )}
                      data-testid={`uat-mapping-group-${group.key}`}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <span className='truncate font-medium'>
                          {group.label}
                        </span>
                        <span className='shrink-0 tabular-nums text-muted-foreground'>
                          {pct(group.coveragePct)}
                        </span>
                      </div>
                      <CoverageBar group={group} className='mt-1.5' />
                      <div className='mt-1 flex justify-between text-xs text-muted-foreground'>
                        <span>
                          {group.itemCount} row{group.itemCount === 1 ? '' : 's'}
                        </span>
                        <span className='tabular-nums'>
                          {fmtMoney(currency, group.unallocatedAmount)} open
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
