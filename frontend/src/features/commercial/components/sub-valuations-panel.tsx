import { useState } from 'react'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCreateSubValuation,
  useDeleteSubValuation,
  useSubValuations,
} from '../hooks/use-commercial'

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function SubValuationsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useSubValuations(projectId)
  const createMutation = useCreateSubValuation(projectId)
  const deleteMutation = useDeleteSubValuation(projectId)

  const [subcontractor, setSubcontractor] = useState('')
  const [period, setPeriod] = useState('')
  const [workDone, setWorkDone] = useState('')

  return (
    <div className='space-y-3'>
      <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-4'>
        <Input
          placeholder='Subcontractor'
          value={subcontractor}
          onChange={(e) => setSubcontractor(e.target.value)}
        />
        <Input
          placeholder='Period (e.g. 2026-04)'
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          step={MONEY_INPUT_STEP}
          placeholder='Work Done'
          value={workDone}
          onChange={(e) => setWorkDone(e.target.value)}
        />
        <Button
          disabled={createMutation.isPending || !subcontractor || !period}
          onClick={async () => {
            if (!hasMoneyPrecision(workDone)) {
              toast.error(MONEY_PRECISION_MESSAGE)
              return
            }

            try {
              await createMutation.mutateAsync({
                subcontractor,
                period,
                workDone: toMoneyNumber(workDone),
              })
              setSubcontractor('')
              setPeriod('')
              setWorkDone('')
              toast.success('Sub valuation created')
            } catch {
              toast.error('Failed to create sub valuation')
            }
          }}
        >
          Add
        </Button>
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Gross</p>
          <p className='font-semibold'>
            {fmtMoney(data?.summary.totalGross || 0)}
          </p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Retention</p>
          <p className='font-semibold'>
            {fmtMoney(data?.summary.totalRetention || 0)}
          </p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Net</p>
          <p className='font-semibold'>
            {fmtMoney(data?.summary.totalNet || 0)}
          </p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Paid</p>
          <p className='font-semibold'>
            {fmtMoney(data?.summary.totalPaid || 0)}
          </p>
        </div>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left'>Ref</th>
              <th className='p-2 text-left'>Subcontractor</th>
              <th className='p-2 text-left'>Period</th>
              <th className='p-2 text-right'>Net</th>
              <th className='p-2 text-left'>Status</th>
              <th className='p-2 text-left'>Trace</th>
              <th className='p-2 text-right'>Action</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && data?.rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className='p-3 text-center text-muted-foreground'
                >
                  No sub valuations yet.
                </td>
              </tr>
            )}
            {data?.rows.map((row) => (
              <tr key={row.id} className='border-b'>
                <td className='p-2 text-xs'>{row.ref}</td>
                <td className='p-2 text-xs'>{row.subcontractor}</td>
                <td className='p-2 text-xs'>{row.period}</td>
                <td className='p-2 text-right text-xs'>
                  {fmtMoney(row.netPayable)}
                </td>
                <td className='p-2 text-xs capitalize'>
                  {row.status.replace('_', ' ')}
                </td>
                <td className='p-2 text-xs text-muted-foreground'>
                  {row.activityLinks?.length || 0} act ·{' '}
                  {row.allocationLinks?.length || 0} alloc ·{' '}
                  {(row.attachmentRefs?.length || 0) +
                    (row.correspondenceLinks?.length || 0)}{' '}
                  docs
                </td>
                <td className='p-2 text-right'>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={deleteMutation.isPending}
                    onClick={async () => {
                      try {
                        await deleteMutation.mutateAsync(row.id)
                        toast.success('Deleted')
                      } catch {
                        toast.error('Delete failed')
                      }
                    }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
