import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CircleAlert, Info } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listOrders, matchOrder, type MatchFlag } from '../data/api'

/**
 * The three-way match: what was ordered, what was accepted, what was billed.
 *
 * It reports rather than blocks. A short delivery is a conversation with the
 * supplier, not an error state, and a system that silently refuses the invoice
 * just moves the argument somewhere nobody can see it.
 */

const VERDICT: Record<string, { label: string; className: string }> = {
  matched: {
    label: 'Matched',
    className: 'border-success/30 bg-success/15 text-success-foreground',
  },
  check: {
    label: 'Worth a look',
    className: 'border-warning/30 bg-warning/15 text-warning-foreground',
  },
  review: {
    label: 'Hold for review',
    className: 'border-error/30 bg-error/15 text-error-foreground',
  },
  unmatched: {
    label: 'No order behind it',
    className: 'bg-muted text-muted-foreground border-border',
  },
}

const FLAG_ICON: Record<MatchFlag['severity'], typeof Info> = {
  blocking: CircleAlert,
  warning: AlertTriangle,
  info: Info,
}

const FLAG_TONE: Record<MatchFlag['severity'], string> = {
  blocking: 'text-error-foreground',
  warning: 'text-warning-foreground',
  info: 'text-muted-foreground',
}

const qty = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })
const money = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function MatchPanel() {
  const [selected, setSelected] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: ['inventory', 'orders', 'all'],
    queryFn: () => listOrders('all'),
  })

  // Open on the first order rather than an empty frame: the point of the page
  // is the comparison, not the picker.
  const activeId = selected ?? orders.data?.[0]?.id ?? null

  const match = useQuery({
    queryKey: ['inventory', 'match', activeId],
    queryFn: () => matchOrder(activeId!),
    enabled: Boolean(activeId),
  })

  const result = match.data
  const verdict = result ? (VERDICT[result.verdict] ?? VERDICT.unmatched) : null

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]' data-testid='uat-match'>
      <Card className='octa-card-plain h-fit'>
        <CardHeader className='pb-2'>
          <CardTitle className='font-display text-base'>Purchase orders</CardTitle>
        </CardHeader>
        <CardContent className='p-2'>
          <ul className='space-y-1' data-testid='uat-match-orders'>
            {(orders.data ?? []).map((order) => (
              <li key={order.id}>
                <button
                  type='button'
                  onClick={() => setSelected(order.id)}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-start transition-colors',
                    order.id === activeId ? 'bg-surface' : 'hover:bg-surface/60'
                  )}
                  data-testid={`uat-match-order-${order.ref}`}
                >
                  <div className='flex items-baseline justify-between gap-2'>
                    <p className='font-mono text-sm font-medium'>{order.ref}</p>
                    <span className='text-[10px] tracking-wide text-muted-foreground uppercase'>
                      {order.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className='truncate text-xs text-muted-foreground'>
                    {order.supplier ?? 'No supplier'}
                  </p>
                </button>
              </li>
            ))}
            {orders.data?.length === 0 && (
              <li className='px-3 py-6 text-center text-sm text-muted-foreground'>
                Nothing is on order.
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {result && verdict && (
        <Card className='octa-card-plain' data-testid='uat-match-result'>
          <CardHeader className='pb-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <CardTitle className='font-display text-lg'>{result.ref}</CardTitle>
                <p className='text-sm text-muted-foreground'>{result.supplier}</p>
              </div>
              <Badge
                variant='outline'
                className={cn('px-3 py-1', verdict.className)}
                data-testid='uat-match-verdict'
              >
                {verdict.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid grid-cols-3 gap-3'>
              {[
                ['Ordered', result.totals.ordered],
                ['Received', result.totals.received],
                ['Invoiced', result.totals.invoiced],
              ].map(([label, value]) => (
                <div key={label as string} className='rounded-md border px-3 py-2'>
                  <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>
                    {label}
                  </p>
                  <p className='font-display mt-0.5 text-lg font-bold tabular-nums'>
                    {money(value as number)}
                  </p>
                </div>
              ))}
            </div>

            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full min-w-[760px] text-sm'>
                <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
                  <tr>
                    <th className='px-3 py-2 text-start'>Line</th>
                    <th className='px-3 py-2 text-end'>Ordered</th>
                    <th className='px-3 py-2 text-end'>Accepted</th>
                    <th className='px-3 py-2 text-end'>Rejected</th>
                    <th className='px-3 py-2 text-end'>Invoiced</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {result.lines.map((line) => (
                    <tr key={line.poLineId} className='align-top'>
                      <td className='px-3 py-2'>
                        <p className='font-medium'>{line.description}</p>
                        {line.flags.length > 0 && (
                          <ul className='mt-1.5 space-y-1' data-testid='uat-match-flags'>
                            {line.flags.map((flag) => {
                              const Icon = FLAG_ICON[flag.severity]
                              return (
                                <li
                                  key={flag.code}
                                  className={cn(
                                    'flex items-start gap-1.5 text-xs',
                                    FLAG_TONE[flag.severity]
                                  )}
                                >
                                  <Icon className='mt-0.5 size-3.5 shrink-0' />
                                  <span>{flag.message}</span>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </td>
                      <td className='px-3 py-2 text-end font-mono tabular-nums'>
                        {qty(line.orderedQty)}
                      </td>
                      <td className='px-3 py-2 text-end font-mono tabular-nums'>
                        {qty(line.receivedQty)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-end font-mono tabular-nums',
                          line.rejectedQty > 0 && 'text-error'
                        )}
                      >
                        {qty(line.rejectedQty)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-end font-mono tabular-nums',
                          line.invoicedQty > line.receivedQty && 'text-error font-semibold'
                        )}
                      >
                        {qty(line.invoicedQty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.invoices.length > 0 && (
              <div>
                <p className='mb-2 text-[11px] tracking-wide text-muted-foreground uppercase'>
                  Invoices against this order
                </p>
                <ul className='space-y-1 text-sm'>
                  {result.invoices.map((invoice) => (
                    <li
                      key={invoice.id}
                      className='flex flex-wrap items-baseline justify-between gap-2 rounded-md border px-3 py-2'
                    >
                      <span className='font-mono'>{invoice.invoiceNumber ?? invoice.ref}</span>
                      <span className='text-muted-foreground'>
                        {invoice.costDate ? formatDate(invoice.costDate) : '—'} ·{' '}
                        <span className='capitalize'>{invoice.status}</span>
                      </span>
                      <span className='font-mono tabular-nums'>{money(invoice.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
