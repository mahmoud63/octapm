import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCreateWeatherDelay,
  useWeatherDelays,
} from '../hooks/use-commercial'

export function WeatherDelaysPanel({ projectId }: { projectId: string }) {
  const { data } = useWeatherDelays(projectId)
  const createMutation = useCreateWeatherDelay(projectId)

  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [delayDays, setDelayDays] = useState('')

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Allowance</p>
          <p className='font-semibold'>{data?.summary.allowance || 0} days</p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Consumed</p>
          <p className='font-semibold'>
            {data?.summary.contractualUsed || 0} days
          </p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Remaining</p>
          <p className='font-semibold'>{data?.summary.remaining || 0} days</p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Consumed %</p>
          <p className='font-semibold'>
            {(data?.summary.consumedPct || 0).toFixed(1)}%
          </p>
        </div>
        <div className='rounded border p-2 text-xs'>
          <p className='text-muted-foreground'>Warning</p>
          <p className='font-semibold'>
            {data?.summary.warning ? '70%+ threshold reached' : 'Normal'}
          </p>
        </div>
      </div>

      <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-4'>
        <Input
          type='date'
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          placeholder='Description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          placeholder='Delay days'
          value={delayDays}
          onChange={(e) => setDelayDays(e.target.value)}
        />
        <Button
          disabled={createMutation.isPending || !description || !delayDays}
          onClick={async () => {
            try {
              await createMutation.mutateAsync({
                date: date || undefined,
                description,
                delayDays: Number(delayDays) || 0,
                contractual: true,
              })
              setDate('')
              setDescription('')
              setDelayDays('')
              toast.success('Weather delay logged')
            } catch {
              toast.error('Failed to log delay')
            }
          }}
        >
          Add Delay
        </Button>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left'>Date</th>
              <th className='p-2 text-left'>Description</th>
              <th className='p-2 text-right'>Days</th>
              <th className='p-2 text-left'>Type</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.id} className='border-b'>
                <td className='p-2 text-xs'>
                  {new Date(row.date).toLocaleDateString()}
                </td>
                <td className='p-2 text-xs'>{row.description}</td>
                <td className='p-2 text-right text-xs'>{row.delayDays}</td>
                <td className='p-2 text-xs'>
                  {row.contractual ? 'Contractual' : 'Non-contractual'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
