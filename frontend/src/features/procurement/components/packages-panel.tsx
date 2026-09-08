import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BallInCourtBadge } from '@/components/ball-in-court'
import { cn } from '@/lib/utils'
import {
  useProcurementPackages,
  usePackageQuotes,
  useRequestQuotes,
  type ProcurementPackage,
} from '../hooks/use-packages'

/**
 * What the project needs bought, and how far along each one is.
 *
 * This is the buyer's starting point, and the reason it exists: asking
 * suppliers to price something used to mean leaving Procurement, finding
 * Commercial, knowing to create a "bid package", knowing to set its commitment
 * type to purchase order, and then holding the connection back to the
 * requirement in your head. The engine underneath is still the same one — it
 * already knew how to level prices and award — but the buyer no longer has to
 * know that (OCTA-PROC-QUOTES-UI-088).
 */

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)

/**
 * Whether the order can still be placed in time.
 *
 * The package already carries the date the goods are needed and the latest date
 * an order can go out and still make it. Once that date is behind us, saying so
 * is the whole point — the buyer cannot un-order something late, but they can
 * escalate it today.
 */
function OrderWindow({ pkg }: { pkg: ProcurementPackage }) {
  if (!pkg.latestOrderDate) return <span className='text-muted-foreground'>—</span>
  const today = new Date().toISOString()
  const slack = daysBetween(today, pkg.latestOrderDate)
  const ordered = pkg.status !== 'planning' && pkg.status !== 'tendering'

  if (ordered) return <span>{formatDate(pkg.latestOrderDate)}</span>

  return (
    <span
      className={cn('whitespace-nowrap', slack < 0 && 'text-error-foreground font-medium')}
      data-testid={`uat-package-window-${pkg.packageNumber}`}
    >
      {formatDate(pkg.latestOrderDate)}
      {slack < 0 ? (
        <span className='ms-1.5 text-[11px]'>{Math.abs(slack)} days late to order</span>
      ) : (
        <span className='text-muted-foreground ms-1.5 text-[11px]'>{slack} days left</span>
      )}
    </span>
  )
}

function Quotes({ projectId, pkg }: { projectId: string; pkg: ProcurementPackage }) {
  const { data: quotes, isLoading } = usePackageQuotes(projectId, pkg.id)
  const request = useRequestQuotes(projectId)

  if (isLoading) {
    return <p className='text-muted-foreground px-3 py-2 text-xs'>Loading quotes…</p>
  }

  if (!quotes?.length) {
    return (
      <div className='flex flex-wrap items-center gap-3 px-3 py-3'>
        <p className='text-muted-foreground text-xs'>
          Nobody has been asked to price this yet.
        </p>
        <Button
          size='sm'
          disabled={request.isPending}
          onClick={() => request.mutate(pkg.id)}
          data-testid={`uat-request-quotes-${pkg.packageNumber}`}
        >
          {request.isPending ? 'Opening…' : 'Request quotes'}
        </Button>
      </div>
    )
  }

  return (
    <div className='space-y-1 px-3 py-3'>
      {quotes.map((quote) => (
        <div
          key={quote.id}
          className='flex flex-wrap items-center justify-between gap-3 text-xs'
          data-testid={`uat-package-quote-${quote.ref}`}
        >
          <div className='flex items-center gap-2'>
            <span className='font-mono font-medium'>{quote.ref}</span>
            <span className='text-muted-foreground'>{quote.title}</span>
          </div>
          <div className='text-muted-foreground flex items-center gap-4'>
            <span>{quote.invitedSuppliers} invited</span>
            <span>{quote.quotesReceived} priced</span>
            <span>Quotes due {formatDate(quote.dueAt)}</span>
            {/* The comparison lives in the bidding engine. The buyer gets taken
                straight to this enquiry rather than told to go and find it.
                A plain anchor because the module sub-paths are resolved at
                runtime and the typed router does not know them. */}
            <a
              href={`/projects/${projectId}/commercial/bids?recordId=${quote.id}&source=bid_package`}
              className='text-primary font-medium hover:underline'
              data-testid={`uat-compare-quotes-${quote.ref}`}
            >
              Compare quotes
            </a>
          </div>
        </div>
      ))}
      <div className='pt-1'>
        <Button
          size='sm'
          variant='outline'
          disabled={request.isPending}
          onClick={() => request.mutate(pkg.id)}
          data-testid={`uat-request-quotes-${pkg.packageNumber}`}
        >
          Request more quotes
        </Button>
      </div>
    </div>
  )
}

export function PackagesPanel({ projectId }: { projectId: string }) {
  const { data: packages, isLoading } = useProcurementPackages(projectId)
  const [openId, setOpenId] = useState<string | null>(null)

  if (isLoading) {
    return <p className='text-muted-foreground text-sm'>Loading packages…</p>
  }

  if (!packages?.length) {
    return (
      <div
        className='rounded-lg border border-dashed p-6 text-center'
        data-testid='uat-packages-empty'
      >
        <p className='text-sm font-medium'>Nothing to buy yet</p>
        <p className='text-muted-foreground mt-1 text-xs'>
          A procurement package is a thing the project needs bought — the date it
          is needed on site, and how long it takes to arrive. Create one from a
          material requirement on the schedule.
        </p>
      </div>
    )
  }

  return (
    <div className='overflow-x-auto rounded-lg border' data-testid='uat-packages'>
      <table className='w-full text-sm'>
        <thead className='bg-surface text-muted-foreground text-xs'>
          <tr className='text-start'>
            <th className='px-3 py-2 text-start'>Package</th>
            <th className='px-3 py-2 text-start'>Needed on site</th>
            <th className='px-3 py-2 text-start'>Order by</th>
            <th className='px-3 py-2 text-start'>Status</th>
          </tr>
        </thead>
        <tbody className='divide-y'>
          {packages.map((pkg) => (
            <>
              <tr
                key={pkg.id}
                className='hover:bg-surface/60 cursor-pointer'
                onClick={() => setOpenId(openId === pkg.id ? null : pkg.id)}
                data-testid={`uat-package-row-${pkg.packageNumber}`}
              >
                <td className='px-3 py-2'>
                  <p className='font-mono font-medium'>{pkg.packageNumber}</p>
                  <p className='text-muted-foreground truncate text-[11px]'>{pkg.title}</p>
                </td>
                <td className='px-3 py-2 whitespace-nowrap'>
                  {formatDate(pkg.requiredOnSiteDate)}
                </td>
                <td className='px-3 py-2'>
                  <OrderWindow pkg={pkg} />
                </td>
                <td className='px-3 py-2'>
                  <div className='flex flex-col items-start gap-1'>
                    <span className='capitalize'>{pkg.status.replace(/_/g, ' ')}</span>
                    <BallInCourtBadge
                      ballInCourt={pkg.ballInCourt}
                      testId={`uat-package-ball-${pkg.packageNumber}`}
                    />
                  </div>
                </td>
              </tr>
              {openId === pkg.id && (
                <tr key={`${pkg.id}-quotes`} className='bg-surface/40'>
                  <td colSpan={4} className='p-0'>
                    <Quotes projectId={projectId} pkg={pkg} />
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}
