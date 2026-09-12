import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  findPurchaseOrder,
  listLocations,
  listWarehouses,
  postGoodsReceipt,
  type GoodsReceiptResult,
  type PurchaseOrder,
} from '../data/api'
import { CodeScanner } from './code-scanner'

/**
 * Goods receipt: scan the purchase order off the delivery note, say what
 * actually turned up, and it becomes stock.
 *
 * Accepted and rejected are separate columns because they are separate facts.
 * What was rejected went back on the lorry — it never becomes stock, but it is
 * recorded, because it is the difference the supplier's invoice will not
 * mention.
 */

type LineEntry = {
  acceptedQty: string
  rejectedQty: string
  batchNo: string
  locationId: string
}

/**
 * A freshly looked-up order proposes every line in full.
 *
 * The common case is that the delivery matches the order, and making somebody
 * type the same number twenty times is how receipts stop being done properly.
 */
const blankEntries = (order: PurchaseOrder): Record<string, LineEntry> =>
  Object.fromEntries(
    order.lines.map((line) => [
      line.id,
      {
        acceptedQty: line.outstandingQty ? String(line.outstandingQty) : '',
        rejectedQty: '',
        batchNo: '',
        locationId: '',
      },
    ])
  )

/**
 * @param initialOrderRef  a purchase order to look up on arrival, so a link
 *   from Procurement lands on the delivery rather than on an empty search box.
 *   There is one receipt screen and one writer behind it; which module you came
 *   from should not change what you have to type.
 */
/**
 * What a posted delivery did, as the goods-receipt service reports it. The
 * shape lives beside the API client so the two cannot drift apart again.
 */
type ReceiptResult = GoodsReceiptResult

export function GoodsReceiptPanel({ initialOrderRef }: { initialOrderRef?: string | null } = {}) {
  const queryClient = useQueryClient()
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [entries, setEntries] = useState<Record<string, LineEntry>>({})
  // The last delivery posted, kept so it can be read rather than announced.
  const [receipt, setReceipt] = useState<ReceiptResult | null>(null)

  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: listWarehouses })
  const effectiveWarehouseId = warehouseId || warehouses.data?.[0]?.id || ''

  const locations = useQuery({
    queryKey: ['warehouse-locations', effectiveWarehouseId],
    queryFn: () => listLocations(effectiveWarehouseId),
    enabled: Boolean(effectiveWarehouseId),
  })

  const lookup = useMutation({
    mutationFn: findPurchaseOrder,
    onSuccess: (found) => {
      setOrder(found)
      setEntries(blankEntries(found))
      setError(null)
    },
    onError: (caught) => {
      setOrder(null)
      setError(getServerErrorMessage(caught))
    },
  })

  // Arriving with an order named: look it up once, exactly as if the storeman
  // had typed it.
  const requestedRef = initialOrderRef ?? null
  const [lookedUpRef, setLookedUpRef] = useState<string | null>(null)
  const { mutate: lookUp } = lookup
  useEffect(() => {
    if (!requestedRef || lookedUpRef === requestedRef) return
    setLookedUpRef(requestedRef)
    lookUp(requestedRef)
  }, [requestedRef, lookedUpRef, lookUp])

  const post = useMutation({
    mutationFn: () => {
      if (!order) throw new Error('No order')
      return postGoodsReceipt({
        orderId: order.id,
        warehouseId: effectiveWarehouseId,
        deliveryNote: deliveryNote.trim() || null,
        lines: order.lines
          .map((line) => {
            const entry = entries[line.id]
            return {
              poLineId: line.id,
              acceptedQty: Number(entry?.acceptedQty) || 0,
              rejectedQty: Number(entry?.rejectedQty) || 0,
              batchNo: entry?.batchNo.trim() || null,
              locationId: entry?.locationId || null,
            }
          })
          .filter((line) => line.acceptedQty > 0 || line.rejectedQty > 0),
      })
    },
    onSuccess: (result) => {
      setReceipt(result)
      toast.success(`${result.receiptNumber} posted`)
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      // Re-read the order so the outstanding column reflects the delivery.
      lookup.mutate(order!.ref)
      setDeliveryNote('')
    },
    onError: (caught) => toast.error(getServerErrorMessage(caught)),
  })

  const update = (lineId: string, patch: Partial<LineEntry>) =>
    setEntries((current) => ({
      ...current,
      [lineId]: { ...current[lineId], ...patch },
    }))

  const anything = Object.values(entries).some(
    (entry) => Number(entry?.acceptedQty) > 0 || Number(entry?.rejectedQty) > 0
  )

  return (
    <div className='space-y-4' data-testid='uat-goods-receipt'>
      {/* What the delivery actually did. A toast says a receipt was posted
          and then takes the answer away with it; a storeman's next questions
          are what was accepted, what is still outstanding, and how much is
          now in the shed (OCTA-UX-RECEIPT-100). */}
      {receipt && (
        <Card className='octa-card-plain' data-testid='uat-receipt-result'>
          <CardHeader className='pb-3'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <CardTitle className='font-display text-base'>
                {receipt.receiptNumber} posted
              </CardTitle>
              <span className='text-muted-foreground text-xs'>
                {receipt.warehouse?.name} · {receipt.order?.ref} is now{' '}
                <span data-testid='uat-receipt-order-status'>
                  {receipt.order?.fullyReceived ? 'fully received' : 'part-delivered'}
                </span>
              </span>
            </div>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead className='text-muted-foreground text-xs'>
                  <tr className='border-b'>
                    <th className='p-2 text-left font-medium'>Item</th>
                    <th className='p-2 text-right font-medium'>Accepted</th>
                    <th className='p-2 text-right font-medium'>Rejected</th>
                    <th className='p-2 text-right font-medium'>Still to come</th>
                    <th className='p-2 text-right font-medium'>On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((line) => (
                    <tr
                      key={line.poLineId}
                      className='border-b last:border-0'
                      data-testid={`uat-receipt-line-${line.poLineId}`}
                    >
                      <td className='p-2'>
                        <span>{line.description}</span>
                        {line.itemSku && (
                          <span className='text-muted-foreground ml-2 font-mono text-xs'>
                            {line.itemSku}
                          </span>
                        )}
                      </td>
                      <td className='p-2 text-right font-mono tabular-nums'>
                        {line.acceptedQty} {line.unit ?? ''}
                      </td>
                      <td className='p-2 text-right font-mono tabular-nums'>
                        {line.rejectedQty > 0 ? (
                          <span className='text-error-foreground'>{line.rejectedQty}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className='p-2 text-right font-mono tabular-nums'>
                        {line.remainingQty > 0 ? line.remainingQty : '—'}
                      </td>
                      <td className='p-2 text-right font-mono tabular-nums'>
                        {line.onHand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className='mt-3 flex flex-wrap gap-4 text-xs'>
              <a
                href='/inventory?tab=items'
                className='text-primary font-medium hover:underline'
                data-testid='uat-receipt-to-stock'
              >
                See it in stock
              </a>
              <a
                href={`/inventory?tab=receive&orderRef=${encodeURIComponent(receipt.order?.ref ?? '')}`}
                className='text-primary font-medium hover:underline'
                data-testid='uat-receipt-again'
              >
                Receive more against this order
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className='octa-card-plain'>
        <CardHeader className='pb-3'>
          <CardTitle className='font-display text-base'>
            Scan the purchase order
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CodeScanner
            onScan={(code) => lookup.mutate(code)}
            busy={lookup.isPending}
            autoFocus={false}
          />
          {error && (
            <p className='mt-3 text-sm text-error-foreground' data-testid='uat-po-error'>
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {order && (
        <Card className='octa-card-plain' data-testid='uat-po-result'>
          <CardHeader className='pb-3'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <CardTitle className='font-display text-lg'>{order.ref}</CardTitle>
              <p className='text-sm text-muted-foreground'>
                {order.supplier} · {order.project}
              </p>
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-2'>
                <Label htmlFor='receipt-warehouse'>Receive into</Label>
                <Select value={effectiveWarehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger id='receipt-warehouse' data-testid='uat-receipt-warehouse'>
                    <SelectValue placeholder='Choose a warehouse' />
                  </SelectTrigger>
                  <SelectContent>
                    {(warehouses.data ?? []).map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='receipt-note'>Delivery note</Label>
                <Input
                  id='receipt-note'
                  value={deliveryNote}
                  onChange={(event) => setDeliveryNote(event.target.value)}
                  placeholder='Supplier’s note number'
                  data-testid='uat-receipt-note'
                />
              </div>
            </div>

            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full min-w-[820px] text-sm'>
                <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
                  <tr>
                    <th className='px-3 py-2 text-start'>Line</th>
                    <th className='px-3 py-2 text-end'>Ordered</th>
                    <th className='px-3 py-2 text-end'>Outstanding</th>
                    <th className='px-3 py-2 text-end'>Accepted</th>
                    <th className='px-3 py-2 text-end'>Rejected</th>
                    <th className='px-3 py-2 text-start'>Batch</th>
                    <th className='px-3 py-2 text-start'>Put away</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {order.lines.map((line) => (
                    <tr key={line.id}>
                      <td className='px-3 py-2'>
                        <p className='font-medium'>{line.description}</p>
                        <p className='font-mono text-[11px] text-muted-foreground'>
                          {line.itemCode} · {line.unit}
                        </p>
                      </td>
                      <td className='px-3 py-2 text-end font-mono tabular-nums'>
                        {line.orderedQty}
                      </td>
                      <td className='px-3 py-2 text-end font-mono tabular-nums'>
                        {line.outstandingQty}
                      </td>
                      <td className='px-3 py-2 text-end'>
                        <Input
                          className='ms-auto h-8 w-24 text-end'
                          inputMode='decimal'
                          value={entries[line.id]?.acceptedQty ?? ''}
                          onChange={(event) =>
                            update(line.id, { acceptedQty: event.target.value })
                          }
                          data-testid={`uat-receipt-accepted-${line.lineNumber}`}
                        />
                      </td>
                      <td className='px-3 py-2 text-end'>
                        <Input
                          className='ms-auto h-8 w-24 text-end'
                          inputMode='decimal'
                          value={entries[line.id]?.rejectedQty ?? ''}
                          onChange={(event) =>
                            update(line.id, { rejectedQty: event.target.value })
                          }
                          data-testid={`uat-receipt-rejected-${line.lineNumber}`}
                        />
                      </td>
                      <td className='px-3 py-2'>
                        <Input
                          className='h-8 w-28'
                          value={entries[line.id]?.batchNo ?? ''}
                          onChange={(event) => update(line.id, { batchNo: event.target.value })}
                        />
                      </td>
                      <td className='px-3 py-2'>
                        <Select
                          value={entries[line.id]?.locationId ?? ''}
                          onValueChange={(value) => update(line.id, { locationId: value })}
                        >
                          <SelectTrigger className='h-8 w-44'>
                            <SelectValue placeholder='Anywhere' />
                          </SelectTrigger>
                          <SelectContent>
                            {(locations.data ?? []).map((location) => (
                              <SelectItem key={location.id} value={location.id}>
                                {location.code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className='flex justify-end'>
              <Button
                onClick={() => post.mutate()}
                disabled={!anything || !effectiveWarehouseId || post.isPending}
                data-testid='uat-receipt-post'
              >
                {post.isPending && <Loader2 className='me-1.5 size-4 animate-spin' />}
                Post goods receipt
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
