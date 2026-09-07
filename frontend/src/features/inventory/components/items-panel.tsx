import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listItems, listWarehouses, type InventoryItem } from '../data/api'
import { MovementDialog, type MovementAction } from './movement-dialog'

/** The stock list: what the company holds, and how much of it is left. */
export function ItemsPanel() {
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [action, setAction] = useState<MovementAction | null>(null)

  const items = useQuery({
    queryKey: ['inventory', 'items', search, lowOnly],
    queryFn: () => listItems({ search: search || undefined, lowStock: lowOnly || undefined }),
  })
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: listWarehouses })

  return (
    <div className='space-y-4' data-testid='uat-inventory-items'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-56 flex-1'>
          <Search className='absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Search by name, SKU, barcode or manufacturer'
            className='ps-9'
            data-testid='uat-items-search'
          />
        </div>
        <Button
          variant={lowOnly ? 'secondary' : 'outline'}
          onClick={() => setLowOnly((value) => !value)}
          aria-pressed={lowOnly}
          data-testid='uat-items-low-stock'
        >
          Below reorder level
        </Button>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full min-w-[820px] text-sm'>
          <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
            <tr>
              <th className='px-3 py-2 text-start'>Item</th>
              <th className='px-3 py-2 text-start'>Category</th>
              <th className='px-3 py-2 text-end'>On hand</th>
              <th className='px-3 py-2 text-end'>Available</th>
              <th className='px-3 py-2 text-end'>Reorder at</th>
              <th className='px-3 py-2 text-end'>Avg cost</th>
              <th className='px-3 py-2 text-end'>Value</th>
              <th className='px-3 py-2' />
            </tr>
          </thead>
          <tbody className='divide-y'>
            {(items.data ?? []).map((item) => (
              <tr key={item.id} className='hover:bg-surface/60'>
                <td className='px-3 py-2'>
                  <p className='font-medium'>{item.name}</p>
                  <p className='font-mono text-[11px] text-muted-foreground'>
                    {item.sku}
                    {item.manufacturer ? ` · ${item.manufacturer}` : ''}
                  </p>
                </td>
                <td className='px-3 py-2 text-muted-foreground'>{item.category ?? '—'}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-end font-mono tabular-nums',
                    item.onHand <= 0 && 'font-semibold text-error'
                  )}
                >
                  {item.onHand} {item.unit}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>{item.available}</td>
                <td className='px-3 py-2 text-end font-mono text-muted-foreground tabular-nums'>
                  {item.reorderLevel}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>
                  {item.averageCost.toLocaleString()}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>
                  {item.value.toLocaleString()}
                </td>
                <td className='px-3 py-2 text-end'>
                  {item.onHand <= 0 ? (
                    <Badge variant='destructive'>Out of stock</Badge>
                  ) : item.belowReorder ? (
                    <Badge className='bg-warning text-octa-charcoal'>Low</Badge>
                  ) : null}
                </td>
                <td className='px-3 py-2 text-end'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => {
                      setSelected(item)
                      setAction('issue')
                    }}
                    data-testid={`uat-item-issue-${item.sku}`}
                  >
                    Issue
                  </Button>
                </td>
              </tr>
            ))}
            {items.data?.length === 0 && (
              <tr>
                <td colSpan={9} className='px-3 py-8 text-center text-muted-foreground'>
                  {lowOnly
                    ? 'Nothing is below its reorder level.'
                    : 'No items match that search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <MovementDialog
        action={action}
        item={selected}
        stock={[]}
        warehouses={warehouses.data ?? []}
        onClose={() => setAction(null)}
        onDone={() => void items.refetch()}
      />
    </div>
  )
}
