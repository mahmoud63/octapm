import { Link } from '@tanstack/react-router'
import { ArrowRight, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  useDeleteSubValuation,
  useSubValuations,
} from '../hooks/use-commercial'

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

/** Money the project has committed to or paid out. These stay. */
const HISTORICAL = ['certified', 'paid']

/**
 * Legacy subcontractor valuations (OCTA-FIN-SUBVAL-064).
 *
 * Retained read-only. They name their subcontractor in free text, hold no
 * schedule of values and post nothing to actual cost — subcontract commitments
 * and their payment applications replaced all three. The rows stay because they
 * are the record of money that moved; what stops is new ones.
 */
export function SubValuationsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useSubValuations(projectId)
  const deleteMutation = useDeleteSubValuation(projectId)
  const rows = data?.rows ?? []

  return (
    <div className='space-y-3' data-testid='uat-subvaluations-panel'>
      <div className='flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3'>
        <Archive className='h-4 w-4 shrink-0 text-muted-foreground' />
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium'>Superseded by payment applications</p>
          <p className='text-xs text-muted-foreground'>
            These valuations name their subcontractor as typed text and never
            reached actual cost. Claims are now made against a subcontract
            commitment, which names the company and posts certified cost to the
            ledger. The {rows.length} valuation{rows.length === 1 ? '' : 's'} here
            {rows.length === 1 ? ' stays' : ' stay'} readable.
          </p>
        </div>
        <Button asChild size='sm' variant='outline'>
          <Link
            to='/projects/$projectId/$module/$child'
            params={{
              projectId,
              module: 'commercial',
              child: 'pay-apps',
            }}
            data-testid='uat-subvaluations-replacement'
          >
            Payment applications <ArrowRight className='ml-1 h-4 w-4' />
          </Link>
        </Button>
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        {[
          ['Gross', data?.summary.totalGross],
          ['Retention', data?.summary.totalRetention],
          ['Net', data?.summary.totalNet],
          ['Paid', data?.summary.totalPaid],
        ].map(([label, value]) => (
          <div key={label as string} className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>{label}</p>
            <p className='font-semibold tabular-nums'>
              {fmtMoney((value as number) || 0)}
            </p>
          </div>
        ))}
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left'>Ref</th>
              <th className='p-2 text-left'>Billed as</th>
              <th className='p-2 text-left'>Period</th>
              <th className='p-2 text-right'>Net</th>
              <th className='p-2 text-left'>Status</th>
              <th className='p-2 text-left'>Trace</th>
              <th className='p-2 text-right'>Action</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className='p-3 text-center text-muted-foreground'
                >
                  None — this project bills its subcontractors through payment
                  applications.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className='border-b'>
                <td className='p-2 text-xs'>{row.ref}</td>
                <td className='p-2 text-xs'>
                  {/* What was typed at the time, and the company it has since
                      been attributed to. The two are kept side by side. */}
                  <div>{row.subcontractor}</div>
                  {row.company ? (
                    <div className='text-[10px] text-muted-foreground'>
                      {row.company.name}
                    </div>
                  ) : (
                    <div className='text-[10px] text-muted-foreground'>
                      no company on file
                    </div>
                  )}
                </td>
                <td className='p-2 text-xs'>{row.period}</td>
                <td className='p-2 text-right text-xs tabular-nums'>
                  {fmtMoney(row.netPayable)}
                </td>
                <td className='p-2 text-xs'>
                  <Badge
                    variant={
                      HISTORICAL.includes(row.status) ? 'default' : 'outline'
                    }
                  >
                    {row.status.replace('_', ' ')}
                  </Badge>
                </td>
                <td className='p-2 text-xs text-muted-foreground'>
                  {row.activityLinks?.length || 0} act ·{' '}
                  {row.allocationLinks?.length || 0} alloc ·{' '}
                  {(row.attachmentRefs?.length || 0) +
                    (row.correspondenceLinks?.length || 0)}{' '}
                  docs
                </td>
                <td className='p-2 text-right'>
                  {HISTORICAL.includes(row.status) ? (
                    <span className='text-[10px] text-muted-foreground'>
                      {row.status === 'paid' ? 'Paid' : 'Certified'} — kept
                    </span>
                  ) : (
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={deleteMutation.isPending}
                      onClick={async () => {
                        try {
                          await deleteMutation.mutateAsync(row.id)
                          toast.success('Deleted')
                        } catch (error) {
                          toast.error(getServerErrorMessage(error))
                        }
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
