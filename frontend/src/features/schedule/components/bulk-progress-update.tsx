import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ScheduleActivity } from '../data/schema'

type Props = {
  projectId: string
  activities: ScheduleActivity[]
}

export function BulkProgressUpdate({ projectId, activities }: Props) {
  const qc = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pctComplete, setPctComplete] = useState(0)
  const [saving, setSaving] = useState(false)

  const selectableActivities = useMemo(
    () => activities.filter((activity) => !activity.isMilestone),
    [activities]
  )

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  return (
    <div className='space-y-3 rounded-md border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm font-semibold'>Bulk Progress Update</p>
        <p className='text-xs text-muted-foreground'>
          Select multiple activities and apply one progress value.
        </p>
      </div>

      <div className='max-h-44 overflow-auto rounded border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Select</th>
              <th className='p-2 text-left font-medium'>Activity</th>
              <th className='p-2 text-right font-medium'>Current %</th>
            </tr>
          </thead>
          <tbody>
            {selectableActivities.map((activity) => (
              <tr key={activity.id} className='border-b'>
                <td className='p-2'>
                  <input
                    type='checkbox'
                    checked={selectedIds.includes(activity.id)}
                    onChange={() => toggle(activity.id)}
                  />
                </td>
                <td className='p-2 text-xs'>
                  {activity.wbsCode ? `${activity.wbsCode} · ` : ''}
                  {activity.name}
                </td>
                <td className='p-2 text-right font-mono text-xs'>
                  {activity.pctComplete}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className='flex flex-wrap items-end gap-3'>
        <div className='w-full max-w-64'>
          <p className='mb-1 text-xs text-muted-foreground'>Set Progress %</p>
          <input
            type='range'
            min={0}
            max={100}
            value={pctComplete}
            onChange={(e) => setPctComplete(Number(e.target.value))}
            className='w-full'
          />
          <p className='text-right font-mono text-xs'>{pctComplete}%</p>
        </div>

        <Button
          disabled={saving || selectedIds.length === 0}
          onClick={async () => {
            setSaving(true)
            try {
              await apiClient.post(
                `/projects/${projectId}/activities/bulk-progress`,
                {
                  updates: selectedIds.map((activityId) => ({
                    activityId,
                    pctComplete,
                  })),
                }
              )

              toast.success('Bulk progress updated')
              setSelectedIds([])

              await Promise.all([
                qc.invalidateQueries({ queryKey: ['schedule', projectId] }),
                qc.invalidateQueries({ queryKey: ['activities', projectId] }),
              ])
            } catch {
              toast.error('Failed to update progress in bulk')
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Applying...' : 'Apply to Selected'}
        </Button>
      </div>
    </div>
  )
}
