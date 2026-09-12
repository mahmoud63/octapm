import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  useCreateWeatherDelay,
  useWeatherDelays,
} from '../hooks/use-commercial'

export function WeatherDelaysPanel({
  projectId,
  activities = [],
  initialRecordId,
}: {
  projectId: string
  activities?: ScheduleActivity[]
  /** The delay a deep link named: selected and brought on screen. */
  initialRecordId?: string
}) {
  const { data } = useWeatherDelays(projectId)
  const targeted = Boolean(
    initialRecordId && data?.rows.some((row) => row.id === initialRecordId)
  )
  useEffect(() => {
    if (!targeted) return
    document
      .getElementById(`uat-record-row-${initialRecordId}`)
      ?.scrollIntoView({ block: 'center' })
  }, [targeted, initialRecordId])
  const createMutation = useCreateWeatherDelay(projectId)

  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [delayDays, setDelayDays] = useState('')
  const [activityIds, setActivityIds] = useState<string[]>([])

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
                affectedActivityIds: activityIds,
                activityLinks: activityIds.map((activityId) => ({
                  activityId,
                  delayDays: Number(delayDays) || 0,
                })),
              })
              setDate('')
              setDescription('')
              setDelayDays('')
              setActivityIds([])
              toast.success('Weather delay logged')
            } catch {
              toast.error('Failed to log delay')
            }
          }}
        >
          Add Delay
        </Button>
        <div className='sm:col-span-4'>
          <div className='grid max-h-32 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2'>
            {activities.map((activity) => (
              <label
                key={activity.id}
                className='flex items-start gap-2 rounded-sm px-2 py-1 text-xs hover:bg-muted/60'
              >
                <input
                  type='checkbox'
                  className='mt-0.5'
                  checked={activityIds.includes(activity.id)}
                  onChange={(e) => {
                    setActivityIds((prev) =>
                      e.target.checked
                        ? [...prev, activity.id]
                        : prev.filter((id) => id !== activity.id)
                    )
                  }}
                />
                <span className='min-w-0 truncate'>
                  {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                  {activity.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left'>Date</th>
              <th className='p-2 text-left'>Description</th>
              <th className='p-2 text-right'>Days</th>
              <th className='p-2 text-left'>Activities</th>
              <th className='p-2 text-left'>Type</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr
                key={row.id}
                id={`uat-record-row-${row.id}`}
                data-testid={`uat-record-row-${row.id}`}
                data-selected={row.id === initialRecordId ? 'true' : 'false'}
                className={
                  row.id === initialRecordId
                    ? 'border-b bg-primary/5 ring-1 ring-primary/40'
                    : 'border-b'
                }
              >
                <td className='p-2 text-xs'>
                  {new Date(row.date).toLocaleDateString()}
                </td>
                <td className='p-2 text-xs'>{row.description}</td>
                <td className='p-2 text-right text-xs'>{row.delayDays}</td>
                <td className='max-w-56 truncate p-2 text-xs'>
                  {row.activityLinks?.length
                    ? row.activityLinks
                        .map((link) => link.activity?.name || link.activityId)
                        .join(', ')
                    : '-'}
                </td>
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
