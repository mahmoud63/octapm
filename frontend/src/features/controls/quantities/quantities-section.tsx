import { AlertTriangle } from 'lucide-react'
import { FIGURE_TRUTH, QUANTITY_TERMS } from '@/lib/financial-terms'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  QUANTITY_FIGURE_KEYS,
  type BoqItemQuantities,
  type QuantityFigure,
  type QuantityFigureKey,
} from '@/features/boq/data/schema'
import { formatQuantity } from '../lib/detail-format'
import { OfficialInstalledNote } from './official-installed'
import {
  useRecordQuantities,
  type RecordQuantitiesKind,
} from './use-record-quantities'

/**
 * The five quantities and the committed quantity of a BOQ item or an activity
 * (PC-6; OCTAPM_PROGRESS_MEASUREMENT §5–§6), drawn one by one from the views
 * payload: five figures with five truths, each with its basis, never merged,
 * never summed across units, and no arithmetic on the client. A figure the
 * server could not give, or may not give this member, is "—" with the
 * server's reason — never a zero that would read as a fact.
 */

const TERM: Record<
  QuantityFigureKey,
  (typeof QUANTITY_TERMS)[keyof typeof QUANTITY_TERMS]
> = {
  installed: QUANTITY_TERMS.installed,
  certified: QUANTITY_TERMS.certified,
  paid: QUANTITY_TERMS.paidProRata,
  received: QUANTITY_TERMS.received,
  issued: QUANTITY_TERMS.issued,
  committed: QUANTITY_TERMS.committedQuantity,
}

const TRUTH_CLASS: Record<string, string> = {
  source: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  derived: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  projection: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
}

const noteReason = (
  note: QuantityFigure['notAvailable'],
  fallback: string
): string | null => {
  if (!note) return null
  if (typeof note === 'object' && 'reason' in note) return note.reason
  return fallback
}

/** Why a figure is not a number: the server's reason, or null when it is one. */
const quantityFigureAbsence = (
  figure: QuantityFigure | null | undefined
): string | null => {
  if (!figure) return 'Not sent by the server'
  const notAvailable = noteReason(
    figure.notAvailable,
    figure.reason ?? 'Not available'
  )
  if (notAvailable) return notAvailable
  const withheld = noteReason(
    figure.withheld,
    figure.reason ?? 'Withheld by the server'
  )
  if (withheld) return withheld
  if (figure.value == null) return figure.reason ?? 'Not available'
  return null
}

/** One quantity figure as the server proved it, with its truth and basis. */
export function QuantityFigureRow({
  figureKey,
  figure,
  fallbackUnit,
  testId,
}: {
  figureKey: QuantityFigureKey
  figure: QuantityFigure | null | undefined
  /** The record's own unit, when the figure names none. */
  fallbackUnit?: string | null
  testId?: string
}) {
  const term = TERM[figureKey]
  const absence = quantityFigureAbsence(figure)
  const unit = figure?.unitCode ?? figure?.unit ?? fallbackUnit ?? ''
  const unitMismatch = figure?.unitMatch === false
  const truth = figure?.truth ?? null
  return (
    <div
      className='flex items-start justify-between gap-3 py-1 text-sm'
      data-testid={testId}
      data-figure={figureKey}
      data-absent={absence ? 'true' : undefined}
    >
      <div className='min-w-0'>
        <p className='text-muted-foreground' title={term.hint}>
          {term.label}
        </p>
        {figure?.basis && (
          <p className='text-[11px] leading-snug text-muted-foreground/80'>
            {figure.basis}
          </p>
        )}
        {unitMismatch && !absence && (
          <p
            className='flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300'
            data-unit-mismatch='true'
          >
            <AlertTriangle className='h-3 w-3 shrink-0' aria-hidden />
            Recorded in {unit || 'another unit'} — not the BOQ unit, so it is
            shown on its own and never added to the others
          </p>
        )}
        {/* Σ approved entries below the official installed figure (a legacy
            typed quantity carried as its floor): the server's two figures,
            side by side, with its reason. */}
        <OfficialInstalledNote
          official={figure?.officialInstalled}
          testId={`${testId ?? figureKey}-official`}
        />
      </div>
      <div className='shrink-0 text-right'>
        {absence ? (
          <span
            className='text-muted-foreground'
            title={absence}
            data-reason={absence}
          >
            —
            <span className='block max-w-56 text-[11px] leading-snug text-muted-foreground/80'>
              {absence}
            </span>
          </span>
        ) : (
          <span className='inline-flex items-center gap-1.5'>
            <span
              className='font-medium tabular-nums'
              data-value={figure?.value ?? ''}
              data-unit={unit}
            >
              {formatQuantity(figure?.value)}
              {unit ? ` ${unit}` : ''}
            </span>
            {truth && FIGURE_TRUTH[truth] && (
              <Badge
                variant='outline'
                className={cn(
                  'px-1 py-0 text-[10px] font-medium',
                  TRUTH_CLASS[truth]
                )}
                title={figure?.basis ?? FIGURE_TRUTH[truth].hint}
                data-truth={truth}
              >
                {FIGURE_TRUTH[truth].label}
              </Badge>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

/** The six rows of one BOQ item block. */
export function QuantityFigureRows({
  block,
  testIdPrefix,
}: {
  block: BoqItemQuantities
  testIdPrefix: string
}) {
  const unit =
    block.unitCode ??
    block.unit ??
    block.boqItem?.unitCode ??
    block.boqItem?.unit ??
    null
  return (
    <>
      {QUANTITY_FIGURE_KEYS.map((key) => (
        <QuantityFigureRow
          key={key}
          figureKey={key}
          figure={block[key]}
          fallbackUnit={unit}
          testId={`${testIdPrefix}-${key}`}
        />
      ))}
      {(block.installedOverAllocation || block.certifiedOverInstalled) && (
        <p
          className='text-[11px] text-amber-700 dark:text-amber-300'
          data-testid={`${testIdPrefix}-comparison`}
        >
          {block.installedOverAllocation &&
            'Installed exceeds the allocation. '}
          {block.certifiedOverInstalled && 'Certified exceeds installed.'}
        </p>
      )}
    </>
  )
}

const hasTopLevelFigures = (block: BoqItemQuantities) =>
  QUANTITY_FIGURE_KEYS.some((key) => block[key] !== undefined)

/**
 * The embeddable section: reads the record's quantities and draws them. A
 * BOQ item answers one block; an activity may answer one block per BOQ item
 * (several units), each drawn under its item and never added up.
 */
export function RecordQuantities({
  projectId,
  kind,
  id,
  testId,
}: {
  projectId: string
  kind: RecordQuantitiesKind
  id: string
  testId: string
}) {
  const { data: read, isLoading } = useRecordQuantities(projectId, kind, id)
  if (isLoading || !read) {
    return (
      <div className='space-y-1' data-testid={`${testId}-loading`}>
        <Skeleton className='h-5 w-full' />
        <Skeleton className='h-5 w-full' />
      </div>
    )
  }
  if (read.state !== 'ok') {
    // Not data: the six labels with "—" and the one reason, so the member
    // sees what exists and why nothing of it is shown.
    return (
      <div data-testid={testId} data-state={read.state}>
        <p
          className='text-sm text-muted-foreground'
          data-testid={`${testId}-${read.state}`}
          data-reason={read.reason}
        >
          — {read.reason}
        </p>
        <dl className='mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-xs text-muted-foreground/80'>
          {QUANTITY_FIGURE_KEYS.map((key) => (
            <div key={key} className='contents'>
              <dt title={TERM[key].hint}>{TERM[key].label}</dt>
              <dd className='text-right' data-figure={key} data-absent='true'>
                —
              </dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }
  const { data } = read
  // The views answer an item's figures under `figures`, its code and
  // description beside them, and its raw comparison under `comparisons`:
  // read as the block the rows draw, nothing computed.
  const perItem: BoqItemQuantities[] = (
    Array.isArray(data.items) ? data.items : (data.byBoqItem ?? [])
  ).map((block) => {
    const flag = (block.comparisons as { certifiedOverInstalled?: { flag?: boolean | null } } | null | undefined)
      ?.certifiedOverInstalled?.flag
    return {
      ...block,
      ...(block.figures ?? {}),
      boqItem:
        block.boqItem ??
        (block.boqItemId
          ? { id: block.boqItemId, code: block.code ?? null, description: block.description ?? null }
          : null),
      certifiedOverInstalled: block.certifiedOverInstalled ?? (flag === true ? true : null),
    }
  })
  const top: BoqItemQuantities | null = data.figures
    ? { ...data.figures, unitCode: data.unitCode, unit: data.unit }
    : hasTopLevelFigures(data)
      ? data
      : null
  return (
    <div data-testid={testId} data-state='ok' className='space-y-2'>
      {top && <QuantityFigureRows block={top} testIdPrefix={testId} />}
      {perItem.map((block, index) => {
        const itemId = block.boqItemId ?? block.boqItem?.id ?? String(index)
        return (
          <div
            key={itemId}
            className='rounded-md border p-2'
            data-testid={`${testId}-item-${itemId}`}
          >
            <p className='text-xs font-medium'>
              {[block.boqItem?.code, block.boqItem?.description]
                .filter(Boolean)
                .join(' · ') || 'BOQ item'}
              {(block.unitCode ?? block.boqItem?.unitCode) && (
                <span className='ml-1 text-muted-foreground'>
                  ({block.unitCode ?? block.boqItem?.unitCode})
                </span>
              )}
            </p>
            <QuantityFigureRows
              block={block}
              testIdPrefix={`${testId}-item-${itemId}`}
            />
          </div>
        )
      })}
      {!top && perItem.length === 0 && (
        <p
          className='text-sm text-muted-foreground'
          data-testid={`${testId}-empty`}
        >
          — The server sent no quantity figure for this record
        </p>
      )}
      {data.asOf && (
        <p className='text-[11px] text-muted-foreground/80'>
          As of {new Date(data.asOf).toLocaleString()}
        </p>
      )}
    </div>
  )
}
