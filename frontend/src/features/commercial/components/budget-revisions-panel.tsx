import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useBudgetRevisions,
  useCreateBudgetRevision,
} from '../hooks/use-commercial'

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function BudgetRevisionsPanel({ projectId }: { projectId: string }) {
  const { data } = useBudgetRevisions(projectId)
  const createMutation = useCreateBudgetRevision(projectId)

  const [title, setTitle] = useState('')
  const [changeType, setChangeType] = useState<'addition' | 'deduction'>(
    'addition'
  )
  const [amount, setAmount] = useState('')

  return (
    <div className='space-y-3'>
      <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-4'>
        <Input
          placeholder='Revision title'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          className='h-9 rounded-md border bg-background px-3 text-sm'
          value={changeType}
          onChange={(e) =>
            setChangeType(e.target.value as 'addition' | 'deduction')
          }
        >
          <option value='addition'>Addition</option>
          <option value='deduction'>Deduction</option>
        </select>
        <Input
          type='number'
          min={0}
          placeholder='Amount'
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button
          disabled={createMutation.isPending || !title || !amount}
          onClick={async () => {
            try {
              await createMutation.mutateAsync({
                title,
                changeType,
                amount: Number(amount) || 0,
              })
              setTitle('')
              setAmount('')
              toast.success('Revision created')
            } catch {
              toast.error('Failed to create revision')
            }
          }}
        >
          Add
        </Button>
      </div>

      <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Original Budget</p>
          <p className='text-lg font-semibold'>
            {fmtMoney(data?.summary.originalBudget || 0)}
          </p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Net Change</p>
          <p className='text-lg font-semibold'>
            {fmtMoney(data?.summary.netChange || 0)}
          </p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Current Budget</p>
          <p className='text-lg font-semibold'>
            {fmtMoney(data?.summary.currentBudget || 0)}
          </p>
        </div>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left'>Ref</th>
              <th className='p-2 text-left'>Title</th>
              <th className='p-2 text-left'>Type</th>
              <th className='p-2 text-right'>Amount</th>
              <th className='p-2 text-right'>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.id} className='border-b'>
                <td className='p-2 text-xs'>{row.ref}</td>
                <td className='p-2 text-xs'>{row.title}</td>
                <td className='p-2 text-xs capitalize'>{row.changeType}</td>
                <td className='p-2 text-right text-xs'>
                  {fmtMoney(row.amount)}
                </td>
                <td className='p-2 text-right text-xs'>
                  {fmtMoney(row.cumulativeBudget)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
