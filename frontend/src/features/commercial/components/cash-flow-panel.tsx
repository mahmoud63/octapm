import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
  useCashFlow,
  useCreateCashFlowEntry,
  useRebuildCashFlow,
} from '../hooks/use-commercial'

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function CashFlowPanel({ projectId }: { projectId: string }) {
  const { data } = useCashFlow(projectId)
  const createMutation = useCreateCashFlowEntry(projectId)
  const rebuildMutation = useRebuildCashFlow(projectId)

  const [period, setPeriod] = useState('')
  const [inflow, setInflow] = useState('')
  const [outflow, setOutflow] = useState('')

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-3 gap-2'>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Inflow</p>
          <p className='font-semibold'>{fmtMoney(data?.summary.inflow || 0)}</p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Outflow</p>
          <p className='font-semibold'>
            {fmtMoney(data?.summary.outflow || 0)}
          </p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Net</p>
          <p className='font-semibold'>{fmtMoney(data?.summary.net || 0)}</p>
        </div>
      </div>

      <div className='rounded-md border p-3'>
        <ResponsiveContainer width='100%' height={240}>
          <BarChart data={data?.monthly || []}>
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis dataKey='period' />
            <YAxis
              tickFormatter={(value) =>
                `$${(Number(value) / 1000).toFixed(0)}k`
              }
            />
            <Tooltip formatter={(value) => fmtMoney(Number(value || 0))} />
            <Bar dataKey='inflow' fill='#16a34a' />
            <Bar dataKey='outflow' fill='#dc2626' />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-4'>
        <Input
          placeholder='YYYY-MM'
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          step={MONEY_INPUT_STEP}
          placeholder='Inflow'
          value={inflow}
          onChange={(e) => setInflow(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          step={MONEY_INPUT_STEP}
          placeholder='Outflow'
          value={outflow}
          onChange={(e) => setOutflow(e.target.value)}
        />
        <div className='flex gap-2'>
          <Button
            disabled={createMutation.isPending || !period}
            onClick={async () => {
              if (!hasMoneyPrecision(inflow) || !hasMoneyPrecision(outflow)) {
                toast.error(MONEY_PRECISION_MESSAGE)
                return
              }

              try {
                await createMutation.mutateAsync({
                  period,
                  inflow: toMoneyNumber(inflow),
                  outflow: toMoneyNumber(outflow),
                })
                setPeriod('')
                setInflow('')
                setOutflow('')
                toast.success('Entry added')
              } catch {
                toast.error('Failed to add entry')
              }
            }}
          >
            Add
          </Button>
          <Button
            variant='outline'
            disabled={rebuildMutation.isPending}
            onClick={async () => {
              try {
                await rebuildMutation.mutateAsync()
                toast.success('Cash flow rebuilt from IPC + sub valuations')
              } catch {
                toast.error('Failed to rebuild cash flow')
              }
            }}
          >
            Rebuild
          </Button>
        </div>
      </div>
    </div>
  )
}
