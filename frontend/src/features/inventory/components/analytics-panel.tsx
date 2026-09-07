import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Loader2 } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getAnalytics,
  type DamagedRow,
  type MaterialNeed,
  type OverstockRow,
  type PriceTrendRow,
  type ShortageRow,
  type SlowMovingRow,
} from '../data/api'

/**
 * The inventory dashboard.
 *
 * Every panel names the rows behind its number. "7 items below reorder" is a
 * statistic; "these 7, short by this much, and 21 days to get them" is a
 * purchase order — and the second one is the only version anybody acts on.
 */

const qty = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
const money = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 0 })

function Panel({
  title,
  hint,
  children,
  className,
  testId,
}: {
  title: string
  hint?: string
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <Card className={cn('octa-card-plain', className)} data-testid={testId}>
      <CardHeader className='pb-2'>
        <CardTitle className='font-display text-base'>{title}</CardTitle>
        {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
      </CardHeader>
      <CardContent className='pt-0'>{children}</CardContent>
    </Card>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className='py-6 text-center text-sm text-muted-foreground'>{children}</p>
}

/** A row of item, one figure, and a second in muted type underneath. */
function ItemRow({
  sku,
  name,
  primary,
  secondary,
  tone,
}: {
  sku: string
  name: string
  primary: string
  secondary: string
  tone?: string
}) {
  return (
    <li className='flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0'>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium'>{name}</p>
        <p className='font-mono text-[11px] text-muted-foreground'>{sku}</p>
      </div>
      <div className='shrink-0 text-end'>
        <p className={cn('font-mono text-sm tabular-nums', tone)}>{primary}</p>
        <p className='text-[11px] text-muted-foreground'>{secondary}</p>
      </div>
    </li>
  )
}

/** A price history, drawn small enough to sit in a table cell. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = 100 / (points.length - 1)
  const path = points
    .map((value, index) => `${index * step},${28 - ((value - min) / span) * 24}`)
    .join(' ')

  return (
    <svg viewBox='0 0 100 28' className='h-7 w-24' preserveAspectRatio='none' aria-hidden='true'>
      <polyline
        points={path}
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinejoin='round'
        strokeLinecap='round'
        vectorEffect='non-scaling-stroke'
      />
    </svg>
  )
}

const ATTENTION = [
  { key: 'lowStock', label: 'Below reorder' },
  { key: 'outOfStock', label: 'Out of stock' },
  { key: 'overstock', label: 'Overstock' },
  { key: 'slowMoving', label: 'Not moving' },
] as const

export function AnalyticsPanel() {
  const [attention, setAttention] = useState<(typeof ATTENTION)[number]['key']>('lowStock')
  const analytics = useQuery({
    queryKey: ['inventory', 'analytics'],
    queryFn: () => getAnalytics(),
  })

  if (analytics.isPending) {
    return (
      <div className='flex justify-center py-16'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }
  if (!analytics.data) return <Empty>The dashboard could not be loaded.</Empty>

  const data = analytics.data
  const attentionRows = data[attention]

  return (
    // items-start so a card with three rows in it is three rows tall, rather
    // than stretched to match whatever is beside it.
    <div className='grid items-start gap-4 lg:grid-cols-2' data-testid='uat-inventory-analytics'>
      <Panel
        title='Where the value is'
        hint='On hand at weighted average — the same basis the ledger posts at.'
        testId='uat-analytics-warehouses'
      >
        <ul className='space-y-3'>
          {data.byWarehouse.map((warehouse) => (
            <li key={warehouse.id}>
              <div className='flex items-baseline justify-between gap-3'>
                <span className='truncate text-sm font-medium'>{warehouse.name}</span>
                <span className='font-mono text-sm tabular-nums'>{money(warehouse.value)}</span>
              </div>
              <div className='mt-1 flex items-center gap-2'>
                <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-surface'>
                  <div
                    className='h-full rounded-full bg-brand-accent'
                    style={{ width: `${Math.max(warehouse.share, 1)}%` }}
                  />
                </div>
                <span className='w-16 shrink-0 text-end text-[11px] text-muted-foreground'>
                  {warehouse.share}% · {warehouse.lines}
                </span>
              </div>
            </li>
          ))}
          {data.byWarehouse.length === 0 && <Empty>No active warehouses.</Empty>}
        </ul>
      </Panel>

      <Panel
        title='Wants attention'
        hint='What is short, what is surplus, and what has not moved.'
        testId='uat-analytics-attention'
      >
        <div className='mb-3 flex flex-wrap gap-1'>
          {ATTENTION.map((tab) => (
            <button
              key={tab.key}
              type='button'
              onClick={() => setAttention(tab.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors',
                attention === tab.key
                  ? 'bg-brand-accent text-white'
                  : 'bg-surface text-muted-foreground hover:text-foreground'
              )}
              data-testid={`uat-analytics-tab-${tab.key}`}
            >
              {tab.label}
              <span className='ms-1.5 tabular-nums opacity-70'>{data[tab.key].length}</span>
            </button>
          ))}
        </div>

        <ul className='max-h-64 overflow-y-auto'>
          {attention === 'lowStock' &&
            (attentionRows as ShortageRow[]).map((row) => (
              <ItemRow
                key={row.id}
                sku={row.sku}
                name={row.name}
                primary={`${qty(row.onHand)} / ${qty(row.reorderLevel)} ${row.unit}`}
                secondary={`short ${qty(row.shortfall)} · ${row.leadTimeDays} days to replace`}
                tone='text-warning-foreground'
              />
            ))}
          {attention === 'outOfStock' &&
            (attentionRows as ShortageRow[]).map((row) => (
              <ItemRow
                key={row.id}
                sku={row.sku}
                name={row.name}
                primary='none'
                secondary={`${row.leadTimeDays} days to replace`}
                tone='text-error-foreground'
              />
            ))}
          {attention === 'overstock' &&
            (attentionRows as OverstockRow[]).map((row) => (
              <ItemRow
                key={row.id}
                sku={row.sku}
                name={row.name}
                primary={`${qty(row.excess)} ${row.unit} over`}
                secondary={`${money(row.excessValue)} tied up`}
              />
            ))}
          {attention === 'slowMoving' &&
            (attentionRows as SlowMovingRow[]).map((row) => (
              <ItemRow
                key={row.id}
                sku={row.sku}
                name={row.name}
                primary={row.daysIdle === null ? 'never moved' : `${row.daysIdle} days`}
                secondary={`${qty(row.onHand)} ${row.unit} · ${money(row.value)}`}
              />
            ))}
          {attentionRows.length === 0 && <Empty>Nothing here — which is the good answer.</Empty>}
        </ul>
      </Panel>

      <Panel
        title='What site consumed'
        hint='Issues by the activity that took them, at what they cost.'
        testId='uat-analytics-usage'
      >
        <ul className='max-h-64 overflow-y-auto'>
          {data.usageByActivity.map((row) => (
            <li
              key={`${row.projectId}-${row.activityId}`}
              className='flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0'
            >
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium'>{row.activity}</p>
                <p className='text-[11px] text-muted-foreground'>
                  <span className='font-mono'>{row.activityRef}</span> · {row.project}
                </p>
              </div>
              <div className='shrink-0 text-end'>
                <p className='font-mono text-sm tabular-nums'>{money(row.value)}</p>
                <p className='text-[11px] text-muted-foreground'>{qty(row.quantity)} issued</p>
              </div>
            </li>
          ))}
          {data.usageByActivity.length === 0 && <Empty>Nothing has been issued yet.</Empty>}
        </ul>
      </Panel>

      <Panel
        title='Damaged and held back'
        hint='Stock that is on the shelf but not usable.'
        testId='uat-analytics-damaged'
      >
        <ul className='max-h-64 overflow-y-auto'>
          {data.damaged.map((row: DamagedRow) => (
            <ItemRow
              key={row.id}
              sku={row.sku}
              name={row.name}
              primary={`${qty(row.damaged + row.quarantined)} ${row.unit}`}
              secondary={`${money(row.damagedValue + row.quarantinedValue)} written down`}
              tone='text-error-foreground'
            />
          ))}
          {data.damaged.length === 0 && <Empty>Nothing damaged or quarantined.</Empty>}
        </ul>
      </Panel>

      <Panel
        title='Ordered, received, used'
        hint='Where the three disagree, and by how much.'
        className='lg:col-span-2'
        testId='uat-analytics-variance'
      >
        <div className='max-h-72 overflow-auto rounded-md border'>
          <table className='w-full min-w-[640px] text-sm'>
            <thead className='sticky top-0 bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
              <tr>
                <th className='px-3 py-2 text-start'>Item</th>
                <th className='px-3 py-2 text-end'>Ordered</th>
                <th className='px-3 py-2 text-end'>Received</th>
                <th className='px-3 py-2 text-end'>Rejected</th>
                <th className='px-3 py-2 text-end'>Issued</th>
                <th className='px-3 py-2 text-end'>Still owed</th>
                <th className='px-3 py-2 text-end'>On hand</th>
              </tr>
            </thead>
            <tbody className='divide-y'>
              {data.variance.map((row) => (
                <tr key={row.itemId}>
                  <td className='px-3 py-2'>
                    <p className='font-medium'>{row.name}</p>
                    <p className='font-mono text-[11px] text-muted-foreground'>
                      {row.sku} · {row.unit}
                    </p>
                  </td>
                  <td className='px-3 py-2 text-end font-mono tabular-nums'>{qty(row.ordered)}</td>
                  <td className='px-3 py-2 text-end font-mono tabular-nums'>{qty(row.received)}</td>
                  <td
                    className={cn(
                      'px-3 py-2 text-end font-mono tabular-nums',
                      row.rejected > 0 && 'text-error-foreground'
                    )}
                  >
                    {qty(row.rejected)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-end font-mono tabular-nums',
                      row.issuedOverReceived > 0 && 'font-semibold text-warning-foreground'
                    )}
                  >
                    {qty(row.issued)}
                  </td>
                  <td className='px-3 py-2 text-end font-mono tabular-nums'>
                    {qty(row.outstanding)}
                  </td>
                  <td className='px-3 py-2 text-end font-mono tabular-nums'>{qty(row.onHand)}</td>
                </tr>
              ))}
              {data.variance.length === 0 && (
                <tr>
                  <td colSpan={7} className='px-3 py-8 text-center text-muted-foreground'>
                    Nothing has been ordered or issued yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title='What the supplier is charging'
        hint='The price actually paid on delivery, first against latest.'
        testId='uat-analytics-prices'
      >
        <ul className='max-h-64 overflow-y-auto'>
          {data.priceTrend.map((row: PriceTrendRow) => (
            <li
              key={row.itemId}
              className='flex items-center justify-between gap-3 border-b py-2 last:border-b-0'
            >
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium'>{row.name}</p>
                <p className='text-[11px] text-muted-foreground'>
                  {row.deliveries} deliveries · {row.first} → {row.last}
                </p>
              </div>
              <div
                className={cn(
                  'flex shrink-0 items-center gap-2',
                  row.changePct > 0 ? 'text-error-foreground' : 'text-success-foreground'
                )}
              >
                <Sparkline points={row.points.map((point) => point.unitCost)} />
                <span className='flex w-16 items-center justify-end gap-0.5 font-mono text-sm tabular-nums'>
                  {row.changePct > 0 ? (
                    <ArrowUpRight className='size-3.5' />
                  ) : (
                    <ArrowDownRight className='size-3.5' />
                  )}
                  {Math.abs(row.changePct)}%
                </span>
              </div>
            </li>
          ))}
          {data.priceTrend.length === 0 && (
            <Empty>No item has been delivered twice yet.</Empty>
          )}
        </ul>
      </Panel>

      <Panel
        title='What the programme needs next'
        hint='From the material plan, against what is on the shelf.'
        testId='uat-analytics-needs'
      >
        <ul className='max-h-64 overflow-y-auto'>
          {data.upcomingNeeds.map((row: MaterialNeed) => (
            <li key={row.id} className='border-b py-2 last:border-b-0'>
              <div className='flex items-baseline justify-between gap-3'>
                <p className='truncate text-sm font-medium'>{row.name}</p>
                <p className='shrink-0 font-mono text-sm tabular-nums'>
                  {qty(row.stillNeeded)} {row.unit}
                </p>
              </div>
              <div className='flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground'>
                <span className='truncate'>
                  <span className='font-mono'>{row.activityRef}</span> · {row.activity}
                </span>
                <span
                  className={cn(
                    'shrink-0',
                    row.daysUntilRequired !== null &&
                      row.daysUntilRequired < row.leadWeeks * 7 &&
                      'text-warning-foreground'
                  )}
                >
                  {row.requiredDate ? formatDate(row.requiredDate) : 'no date'}
                  {row.daysUntilRequired !== null && ` · ${row.daysUntilRequired}d`}
                </span>
              </div>
            </li>
          ))}
          {data.upcomingNeeds.length === 0 && <Empty>The material plan is fully covered.</Empty>}
        </ul>
      </Panel>

      <Panel
        title='Long lead'
        hint='Eight weeks or more from the supplier, and not all of it has arrived.'
        className='lg:col-span-2'
        testId='uat-analytics-long-lead'
      >
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full min-w-[680px] text-sm'>
            <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
              <tr>
                <th className='px-3 py-2 text-start'>Material</th>
                <th className='px-3 py-2 text-start'>Activity</th>
                <th className='px-3 py-2 text-end'>Still needed</th>
                <th className='px-3 py-2 text-end'>Lead</th>
                <th className='px-3 py-2 text-start'>Order by</th>
                <th className='px-3 py-2 text-start'>Needed on site</th>
              </tr>
            </thead>
            <tbody className='divide-y'>
              {data.longLead.map((row) => {
                // Past its order-by date and still short: the whole reason this
                // list exists.
                const late = row.orderByDate ? new Date(row.orderByDate) < new Date() : false
                return (
                  <tr key={row.id}>
                    <td className='px-3 py-2'>
                      <p className='font-medium'>{row.name}</p>
                      {row.code && (
                        <p className='font-mono text-[11px] text-muted-foreground'>{row.code}</p>
                      )}
                    </td>
                    <td className='px-3 py-2 text-muted-foreground'>
                      <span className='font-mono text-[11px]'>{row.activityRef}</span>{' '}
                      {row.activity}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {qty(row.stillNeeded)} {row.unit}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {row.leadWeeks}w
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2',
                        late ? 'font-semibold text-error-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {row.orderByDate ? formatDate(row.orderByDate) : '—'}
                      {late && ' · overdue'}
                    </td>
                    <td className='px-3 py-2 text-muted-foreground'>
                      {row.requiredDate ? formatDate(row.requiredDate) : '—'}
                    </td>
                  </tr>
                )
              })}
              {data.longLead.length === 0 && (
                <tr>
                  <td colSpan={6} className='px-3 py-8 text-center text-muted-foreground'>
                    Nothing on a long lead is outstanding.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
