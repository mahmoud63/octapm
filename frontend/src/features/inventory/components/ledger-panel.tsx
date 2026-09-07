import { useQuery } from '@tanstack/react-query'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { listTransactions } from '../data/api'

/**
 * The ledger, newest first.
 *
 * Every movement, with what the balance was after it — which is the column
 * that makes a stock figure arguable rather than asserted.
 */
export function LedgerPanel() {
  const movements = useQuery({
    queryKey: ['inventory', 'ledger'],
    queryFn: () => listTransactions({ limit: 200 }),
  })

  return (
    <div className='overflow-x-auto rounded-md border' data-testid='uat-inventory-ledger'>
      <table className='w-full min-w-[900px] text-sm'>
        <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
          <tr>
            <th className='px-3 py-2 text-start'>When</th>
            <th className='px-3 py-2 text-start'>Movement</th>
            <th className='px-3 py-2 text-start'>Item</th>
            <th className='px-3 py-2 text-start'>Where</th>
            <th className='px-3 py-2 text-end'>Quantity</th>
            <th className='px-3 py-2 text-end'>Value</th>
            <th className='px-3 py-2 text-end'>Balance after</th>
            <th className='px-3 py-2 text-start'>Reference</th>
          </tr>
        </thead>
        <tbody className='divide-y'>
          {(movements.data ?? []).map((movement) => (
            <tr key={movement.id} className='hover:bg-surface/60'>
              <td className='px-3 py-2 whitespace-nowrap text-muted-foreground'>
                {movement.occurredAt ? formatDateTime(movement.occurredAt) : '—'}
              </td>
              <td className='px-3 py-2 capitalize'>{movement.type.replace('_', ' ')}</td>
              <td className='px-3 py-2'>
                <span className='font-medium'>{movement.item?.name ?? '—'}</span>
                <span className='ms-2 font-mono text-[11px] text-muted-foreground'>
                  {movement.item?.sku}
                </span>
              </td>
              <td className='px-3 py-2 text-muted-foreground'>
                {movement.warehouse}
                {movement.location ? ` · ${movement.location}` : ''}
              </td>
              <td
                className={cn(
                  'px-3 py-2 text-end font-mono tabular-nums',
                  movement.quantity < 0 ? 'text-error' : 'text-success'
                )}
              >
                {movement.quantity > 0 ? '+' : ''}
                {movement.quantity}
              </td>
              <td className='px-3 py-2 text-end font-mono tabular-nums'>
                {movement.value.toLocaleString()}
              </td>
              <td className='px-3 py-2 text-end font-mono tabular-nums'>
                {movement.balanceAfter}
              </td>
              <td className='px-3 py-2 text-muted-foreground'>
                {movement.reference ?? movement.notes ?? '—'}
              </td>
            </tr>
          ))}
          {movements.data?.length === 0 && (
            <tr>
              <td colSpan={8} className='px-3 py-8 text-center text-muted-foreground'>
                Nothing has moved yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
