import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  MapPin,
  PackageSearch,
  Undo2,
  Wrench,
} from 'lucide-react'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listTransactions, listWarehouses, scanCode, type ScanResult } from '../data/api'
import { CodeScanner } from './code-scanner'
import { MovementDialog, type MovementAction } from './movement-dialog'

/**
 * Scan, then act.
 *
 * The whole point of the barcode is that one scan answers "what is this, how
 * much is there and where", and then offers the four things a storeman does
 * next. Everything on this page is reachable one-handed on a phone.
 */

const ACTIONS: Array<{
  action: MovementAction
  label: string
  icon: typeof ArrowDownToLine
  tone?: 'accent' | 'plain'
}> = [
  { action: 'issue', label: 'Issue to site', icon: ArrowUpFromLine, tone: 'accent' },
  { action: 'receive', label: 'Receive', icon: ArrowDownToLine },
  { action: 'return', label: 'Return', icon: Undo2 },
  { action: 'damage', label: 'Damaged', icon: Wrench },
  { action: 'quarantine', label: 'Quarantine', icon: Ban },
  { action: 'adjust', label: 'Adjust', icon: PackageSearch },
]

export function ScanWorkspace() {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<MovementAction | null>(null)

  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: listWarehouses })

  const history = useQuery({
    queryKey: ['inventory', 'history', result?.item.id],
    queryFn: () => listTransactions({ itemId: result!.item.id, limit: 8 }),
    enabled: Boolean(result?.item.id),
  })

  const lookup = useMutation({
    mutationFn: scanCode,
    onSuccess: (found) => {
      setResult(found)
      setError(null)
    },
    onError: (caught) => {
      setResult(null)
      setError(getServerErrorMessage(caught))
    },
  })

  const refresh = () => {
    if (result) lookup.mutate(result.item.sku)
  }

  return (
    <div className='space-y-4' data-testid='uat-inventory-scan'>
      <Card className='octa-card-plain'>
        <CardHeader className='pb-3'>
          <CardTitle className='font-display text-base'>Scan an item</CardTitle>
        </CardHeader>
        <CardContent>
          <CodeScanner onScan={(code) => lookup.mutate(code)} busy={lookup.isPending} />
          {error && (
            <p className='mt-3 text-sm text-error-foreground' data-testid='uat-scan-error'>
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          <Card className='octa-card-plain' data-testid='uat-scan-result'>
            <CardHeader className='pb-3'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <CardTitle className='font-display text-lg'>
                    {result.item.name}
                  </CardTitle>
                  <p className='mt-0.5 font-mono text-xs text-muted-foreground'>
                    {result.item.sku}
                    {result.item.barcode ? ` · ${result.item.barcode}` : ''}
                  </p>
                </div>
                {result.item.belowReorder ? (
                  <Badge variant='destructive'>Below reorder level</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              <dl className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                {[
                  ['On hand', `${result.item.onHand} ${result.item.unit}`],
                  ['Available', `${result.item.available} ${result.item.unit}`],
                  ['Value', result.item.value.toLocaleString()],
                  ['Average cost', result.item.averageCost.toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className='rounded-md border bg-surface px-3 py-2'>
                    <dt className='text-[11px] tracking-wide text-muted-foreground uppercase'>
                      {label}
                    </dt>
                    <dd className='font-display mt-0.5 text-base font-bold tabular-nums'>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div>
                <h3 className='mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
                  Where it is
                </h3>
                {result.stock.length ? (
                  <ul className='space-y-1.5' data-testid='uat-scan-locations'>
                    {result.stock.map((line) => (
                      <li
                        key={`${line.warehouseId}-${line.locationId ?? 'root'}`}
                        className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'
                      >
                        <MapPin className='size-3.5 shrink-0 text-interactive' />
                        <span className='min-w-0 flex-1 truncate'>
                          {line.warehouse}
                          {line.locationCode ? (
                            <span className='text-muted-foreground'>
                              {' '}
                              · {line.locationCode}
                            </span>
                          ) : null}
                        </span>
                        <span className='shrink-0 font-mono text-xs tabular-nums'>
                          {line.onHand} {result.item.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    None of this is in stock anywhere.
                  </p>
                )}
              </div>

              <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                {ACTIONS.map((entry) => (
                  <Button
                    key={entry.action}
                    variant={entry.tone === 'accent' ? 'default' : 'outline'}
                    onClick={() => setAction(entry.action)}
                    data-testid={`uat-scan-action-${entry.action}`}
                  >
                    <entry.icon className='me-1.5 size-4' />
                    {entry.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className='octa-card-plain'>
            <CardHeader className='pb-3'>
              <CardTitle className='font-display text-base'>Recent movements</CardTitle>
            </CardHeader>
            <CardContent>
              {history.data?.length ? (
                <ul className='divide-y'>
                  {history.data.map((movement) => (
                    <li
                      key={movement.id}
                      className='flex items-center gap-3 py-2 text-sm'
                    >
                      <span className='w-20 shrink-0 text-xs text-muted-foreground capitalize'>
                        {movement.type.replace('_', ' ')}
                      </span>
                      <span
                        className={
                          movement.quantity < 0
                            ? 'w-20 shrink-0 font-mono tabular-nums text-error'
                            : 'w-20 shrink-0 font-mono tabular-nums text-success'
                        }
                      >
                        {movement.quantity > 0 ? '+' : ''}
                        {movement.quantity}
                      </span>
                      <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
                        {movement.warehouse}
                        {movement.location ? ` · ${movement.location}` : ''}
                        {movement.reference ? ` · ${movement.reference}` : ''}
                      </span>
                      <span className='shrink-0 font-mono text-xs text-muted-foreground tabular-nums'>
                        {movement.balanceAfter}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-sm text-muted-foreground'>Nothing recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <MovementDialog
        action={action}
        item={result?.item ?? null}
        stock={result?.stock ?? []}
        warehouses={warehouses.data ?? []}
        onClose={() => setAction(null)}
        onDone={refresh}
      />
    </div>
  )
}
