import type { BoqFinancialSummary } from '../data/schema'

interface Props {
  financial: BoqFinancialSummary
  currency: string
}

const fmt = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)

export function BoqFinancialSummary({ financial, currency }: Props) {
  return (
    <div className='rounded-lg border bg-card p-5'>
      <h3 className='mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
        Financial Summary
      </h3>

      <div className='space-y-2'>
        {/* Subtotal 1 */}
        <div className='flex items-center justify-between text-sm'>
          <span>Subtotal (BOQ Items)</span>
          <span className='font-medium tabular-nums'>
            {fmt(financial.subtotal1, currency)}
          </span>
        </div>

        <div className='flex items-center justify-between text-sm text-muted-foreground'>
          <span>Scheduled Value</span>
          <span className='tabular-nums'>
            {fmt(financial.scheduledValue ?? 0, currency)}
          </span>
        </div>

        <div className='flex items-center justify-between text-sm text-muted-foreground'>
          <span>Unscheduled Value</span>
          <span className='tabular-nums'>
            {fmt(financial.unscheduledValue ?? financial.subtotal1, currency)}
          </span>
        </div>

        <div className='flex items-center justify-between text-sm text-muted-foreground'>
          <span>Earned Value</span>
          <span className='tabular-nums'>
            {fmt(financial.earnedValue ?? 0, currency)}
          </span>
        </div>

        <div className='flex items-center justify-between text-sm text-muted-foreground'>
          <span>Certified Value</span>
          <span className='tabular-nums'>
            {fmt(financial.certifiedValue ?? 0, currency)}
          </span>
        </div>

        {/* Extra services */}
        {financial.extraServices.map((svc) => (
          <div key={svc.label} className='flex items-center justify-between text-sm text-muted-foreground'>
            <span>
              {svc.label} ({svc.percentage}%)
            </span>
            <span className='tabular-nums'>+{fmt(svc.value ?? 0, currency)}</span>
          </div>
        ))}

        <div className='my-2 border-t' />

        {/* Subtotal 2 */}
        <div className='flex items-center justify-between text-sm font-medium'>
          <span>Subtotal (with Services)</span>
          <span className='tabular-nums'>{fmt(financial.subtotal2, currency)}</span>
        </div>

        {/* Total */}
        <div className='flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-base font-bold'>
          <span>Total Project Cost</span>
          <span className='tabular-nums text-primary'>
            {fmt(financial.totalProjectCost, currency)}
          </span>
        </div>
      </div>
    </div>
  )
}
