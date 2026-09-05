import { useState } from 'react'
import { Download, Loader2, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  downloadBidLeveling,
  formatBidDate,
  formatBidMoney,
  useAwardBid,
  useBidLeveling,
  useBidPackageAction,
  useConfirmBidAward,
  type BidPackage,
} from '../hooks/use-bids'

/** Submitted bids side by side with plugs for excluded lines, XLSX export, soft award and confirmation. */
export function BidLevelingGrid({
  projectId,
  pkg,
}: {
  projectId: string
  pkg: BidPackage
}) {
  const canAward = useCanPerform('bid', 'approve', 'bid.award')
  const canExport = useCanPerform('bid', 'export')
  const { data, isLoading } = useBidLeveling(projectId, pkg.id)
  const award = useAwardBid(projectId)
  const revoke = useBidPackageAction(projectId)
  const confirm = useConfirmBidAward(projectId)
  const [exporting, setExporting] = useState(false)
  const [confirmForm, setConfirmForm] = useState({
    retentionRate: '',
    startDate: '',
    endDate: '',
  })

  if (isLoading || !data) {
    return (
      <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading bids…
      </p>
    )
  }
  const { bidders, lines, cells, lineStats } = data
  const softBidder = bidders.find((bidder) => bidder.isSoftAward)

  return (
    <div className='space-y-3' data-testid='uat-bid-leveling'>
      <div className='flex flex-wrap items-center gap-2'>
        <p className='text-sm text-muted-foreground'>
          {bidders.length} bid{bidders.length === 1 ? '' : 's'} · internal
          estimate {formatBidMoney(data.estimateTotal, pkg.currency)}. Excluded
          or unpriced lines are plugged with the average of the other bids (or
          the estimate) so normalised totals compare like for like.
        </p>
        {canExport && bidders.length > 0 && (
          <Button
            size='sm'
            variant='outline'
            className='ml-auto'
            disabled={exporting}
            data-testid='uat-bid-leveling-export'
            onClick={async () => {
              setExporting(true)
              try {
                await downloadBidLeveling(projectId, pkg.id)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              } finally {
                setExporting(false)
              }
            }}
          >
            {exporting ? (
              <Loader2 className='mr-1 h-4 w-4 animate-spin' />
            ) : (
              <Download className='mr-1 h-4 w-4' />
            )}
            Leveling XLSX
          </Button>
        )}
      </div>

      {bidders.length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No bids submitted yet.
        </p>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-xs'>
              <thead className='bg-muted/40'>
                <tr>
                  <th className='px-2 py-1 text-left'>#</th>
                  <th className='px-2 py-1 text-left'>Line</th>
                  <th className='px-2 py-1 text-right'>Qty</th>
                  <th className='px-2 py-1 text-right'>Estimate</th>
                  {bidders.map((bidder) => (
                    <th
                      key={bidder.bidId}
                      className='px-2 py-1 text-right'
                      colSpan={2}
                    >
                      <span className='flex items-center justify-end gap-1'>
                        {bidder.isAwarded && (
                          <Trophy className='h-3 w-3 text-primary' />
                        )}
                        {bidder.companyName}
                        <Badge
                          variant='outline'
                          className='px-1 py-0 text-[10px]'
                        >
                          #{bidder.rank}
                        </Badge>
                      </span>
                    </th>
                  ))}
                  <th className='px-2 py-1 text-right'>Low</th>
                  <th className='px-2 py-1 text-right'>Spread</th>
                </tr>
                <tr className='text-[10px] text-muted-foreground'>
                  <th colSpan={4} />
                  {bidders.map((bidder) => (
                    <th
                      key={`${bidder.bidId}-sub`}
                      colSpan={2}
                      className='px-2 text-right font-normal'
                    >
                      rate · amount
                    </th>
                  ))}
                  <th colSpan={2} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const stats = lineStats[line.id]
                  return (
                    <tr key={line.id} className='border-t'>
                      <td className='px-2 py-1'>{line.lineNumber}</td>
                      <td
                        className='max-w-64 truncate px-2 py-1'
                        title={line.description}
                      >
                        {line.code ? `${line.code} ` : ''}
                        {line.description}
                        {line.unit ? (
                          <span className='text-muted-foreground'>
                            {' '}
                            ({line.unit})
                          </span>
                        ) : null}
                      </td>
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {line.qty.toLocaleString()}
                      </td>
                      <td className='px-2 py-1 text-right text-muted-foreground tabular-nums'>
                        {line.estimateAmount?.toLocaleString() ?? '—'}
                      </td>
                      {bidders.map((bidder) => {
                        const cell = cells[bidder.bidId]?.[line.id]
                        return (
                          <td
                            key={`${bidder.bidId}-${line.id}`}
                            colSpan={2}
                            className={cn(
                              'px-2 py-1 text-right tabular-nums',
                              cell?.isLow && 'bg-green-500/10 font-medium',
                              cell?.plugged && 'text-muted-foreground italic'
                            )}
                            title={cell?.note ?? undefined}
                          >
                            {cell?.plugged ? (
                              <>
                                excl. · plug{' '}
                                {cell.normalizedAmount?.toLocaleString()}
                              </>
                            ) : (
                              <>
                                {cell?.rate?.toLocaleString()} ·{' '}
                                {cell?.amount?.toLocaleString()}
                              </>
                            )}
                          </td>
                        )
                      })}
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {stats?.low?.toLocaleString() ?? '—'}
                      </td>
                      <td className='px-2 py-1 text-right text-muted-foreground tabular-nums'>
                        {stats?.spread?.toLocaleString() ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className='font-medium'>
                <tr className='border-t'>
                  <td colSpan={3} className='px-2 py-1 text-right'>
                    Total as bid
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {data.estimateTotal.toLocaleString()}
                  </td>
                  {bidders.map((bidder) => (
                    <td
                      key={`${bidder.bidId}-total`}
                      colSpan={2}
                      className='px-2 py-1 text-right tabular-nums'
                    >
                      {bidder.total.toLocaleString()}
                    </td>
                  ))}
                  <td colSpan={2} />
                </tr>
                <tr className='border-t'>
                  <td colSpan={3} className='px-2 py-1 text-right'>
                    Normalised total
                  </td>
                  <td />
                  {bidders.map((bidder) => (
                    <td
                      key={`${bidder.bidId}-norm`}
                      colSpan={2}
                      className={cn(
                        'px-2 py-1 text-right tabular-nums',
                        bidder.rank === 1 &&
                          'text-green-700 dark:text-green-400'
                      )}
                    >
                      {bidder.normalizedTotal.toLocaleString()}
                      {bidder.pluggedLines ? (
                        <span className='text-[10px] text-muted-foreground'>
                          {' '}
                          ({bidder.pluggedLines} plug
                          {bidder.pluggedLines === 1 ? '' : 's'})
                        </span>
                      ) : null}
                    </td>
                  ))}
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className='grid gap-2 md:grid-cols-2'>
            {bidders.map((bidder) => (
              <div
                key={bidder.bidId}
                className={cn(
                  'space-y-1 rounded-md border p-2 text-sm',
                  bidder.isSoftAward && 'border-primary'
                )}
                data-testid={`uat-bid-bidder-${bidder.rank}`}
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>
                    #{bidder.rank} {bidder.companyName}
                  </span>
                  <Badge variant='outline'>{bidder.status}</Badge>
                  {bidder.isSoftAward && !bidder.isAwarded && (
                    <Badge>Selected</Badge>
                  )}
                  {bidder.isAwarded && <Badge>Awarded</Badge>}
                  <span className='ml-auto tabular-nums'>
                    {formatBidMoney(bidder.total, pkg.currency)}
                  </span>
                </div>
                <p className='text-xs text-muted-foreground'>
                  submitted {formatBidDate(bidder.submittedAt)}
                  {bidder.validityDays !== null
                    ? ` · valid ${bidder.validityDays} days`
                    : ''}
                  {bidder.leadTimeDays !== null
                    ? ` · lead time ${bidder.leadTimeDays} days`
                    : ''}
                  {bidder.lowLines
                    ? ` · lowest on ${bidder.lowLines} line${bidder.lowLines === 1 ? '' : 's'}`
                    : ''}
                </p>
                {bidder.inclusions && (
                  <p className='text-xs'>
                    <span className='font-medium'>Includes:</span>{' '}
                    {bidder.inclusions}
                  </p>
                )}
                {bidder.exclusions && (
                  <p className='text-xs'>
                    <span className='font-medium'>Excludes:</span>{' '}
                    {bidder.exclusions}
                  </p>
                )}
                {bidder.notes && (
                  <p className='text-xs text-muted-foreground'>
                    {bidder.notes}
                  </p>
                )}
                {canAward &&
                  pkg.status !== 'awarded' &&
                  bidder.status === 'submitted' &&
                  !bidder.isSoftAward && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='h-7'
                      disabled={award.isPending}
                      data-testid='uat-bid-soft-award'
                      onClick={async () => {
                        try {
                          await award.mutateAsync({
                            packageId: pkg.id,
                            bidId: bidder.bidId,
                          })
                          toast.success(
                            `${bidder.companyName} selected — confirm to create the commitment`
                          )
                        } catch (error) {
                          toast.error(getServerErrorMessage(error))
                        }
                      }}
                    >
                      Select (soft award)
                    </Button>
                  )}
              </div>
            ))}
          </div>

          {canAward && softBidder && pkg.status !== 'awarded' && (
            <div
              className='space-y-2 rounded-md border border-primary/50 p-3'
              data-testid='uat-bid-confirm-award'
            >
              <p className='text-sm font-medium'>
                Confirm award to {softBidder.companyName} ·{' '}
                {formatBidMoney(softBidder.total, pkg.currency)}
              </p>
              <p className='text-xs text-muted-foreground'>
                Creates a{' '}
                {pkg.commitmentType === 'purchase_order'
                  ? 'purchase-order commitment'
                  : 'subcontract'}{' '}
                for the vendor with the schedule of values from the priced
                lines; the other bidders are told they were unsuccessful.
              </p>
              <div className='grid gap-2 sm:grid-cols-3'>
                <div className='space-y-1'>
                  <Label className='text-xs'>Retention %</Label>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    placeholder='Project default'
                    value={confirmForm.retentionRate}
                    onChange={(event) =>
                      setConfirmForm({
                        ...confirmForm,
                        retentionRate: event.target.value,
                      })
                    }
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs'>Start</Label>
                  <Input
                    type='date'
                    value={confirmForm.startDate}
                    onChange={(event) =>
                      setConfirmForm({
                        ...confirmForm,
                        startDate: event.target.value,
                      })
                    }
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs'>Finish</Label>
                  <Input
                    type='date'
                    value={confirmForm.endDate}
                    onChange={(event) =>
                      setConfirmForm({
                        ...confirmForm,
                        endDate: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button
                  size='sm'
                  disabled={confirm.isPending}
                  data-testid='uat-bid-confirm'
                  onClick={async () => {
                    try {
                      const result = await confirm.mutateAsync({
                        packageId: pkg.id,
                        payload: {
                          retentionRate:
                            confirmForm.retentionRate === ''
                              ? null
                              : Number(confirmForm.retentionRate),
                          startDate: confirmForm.startDate || null,
                          endDate: confirmForm.endDate || null,
                        },
                      })
                      toast.success(
                        `Awarded — commitment ${result.commitment?.ref ?? ''} created`
                      )
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  {confirm.isPending && (
                    <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                  )}
                  Confirm award & create commitment
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke
                      .mutateAsync({
                        packageId: pkg.id,
                        action: 'award/revoke',
                      })
                      .catch((error) =>
                        toast.error(getServerErrorMessage(error))
                      )
                  }
                >
                  Clear selection
                </Button>
              </div>
            </div>
          )}
          {pkg.status === 'awarded' && (
            <p className='text-sm text-muted-foreground'>
              Awarded {formatBidDate(pkg.awardedAt)}. The commitment is under
              Commercial › Commitments.
            </p>
          )}
        </>
      )}
    </div>
  )
}
