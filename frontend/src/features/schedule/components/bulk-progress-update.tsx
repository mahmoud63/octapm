import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import type {
  ActivityProgressExtras,
  ScheduleActivity,
} from '../data/schema'

type Props = {
  projectId: string
  activities: ScheduleActivity[]
}

const PROGRESS_ASSIGNMENT_OVERRIDE_ROLES = new Set(['pm', 'planning_eng'])

const isProgressAssignmentOverride = (role?: string | null) =>
  PROGRESS_ASSIGNMENT_OVERRIDE_ROLES.has(String(role || '').toLowerCase())

// PC-6: the official figure's PROGRESS SOURCE beside it — the server's
// structured provenance first, the older source string otherwise.
const SOURCE_WORD: Record<string, string> = {
  manual: 'Manual submission',
  mobile: 'Mobile capture',
  daily_log: 'Daily log',
  daily_report: 'Daily report',
  import: 'Progress import',
  submission: 'Submission',
}

const progressSourceOf = (activity: ScheduleActivity): string | null => {
  const provenance = (activity as ScheduleActivity & ActivityProgressExtras)
    .progressSource
  if (provenance) {
    if (provenance.label) return provenance.label
    const source = provenance.source
      ? (SOURCE_WORD[provenance.source] ?? provenance.source)
      : 'Progress'
    const dates = provenance.dailyLogDates?.length
      ? provenance.dailyLogDates.join(', ')
      : provenance.dailyLogDate
    const who = provenance.approvedByName ?? provenance.approvedBy
    return [source, dates, who ? `approved by ${who}` : null]
      .filter(Boolean)
      .join(' · ')
  }
  const source = activity.approvedProgressSource
  return source ? (SOURCE_WORD[source] ?? source) : null
}

const errorCodeFrom = (error: unknown) =>
  (
    error as {
      response?: { data?: { error?: { code?: string } } }
    }
  )?.response?.data?.error?.code

export function BulkProgressUpdate({ projectId, activities }: Props) {
  const canSubmitProgress = useCanPerform(
    'progress',
    'submit',
    'submission.submit'
  )
  const currentUser = useAuthStore((state) => state.auth.user)
  const qc = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pctComplete, setPctComplete] = useState(0)
  const [saving, setSaving] = useState(false)
  const currentUserId = currentUser?.id ?? ''
  const currentUserRole = currentUser?.role ?? ''
  const assignmentOverride = useMemo(
    () => isProgressAssignmentOverride(currentUserRole),
    [currentUserRole]
  )

  const selectableActivities = useMemo(() => {
    const editableActivities = activities.filter(
      (activity) => !activity.isMilestone
    )
    if (assignmentOverride) return editableActivities
    if (!currentUserId) return []

    return editableActivities.filter((activity) =>
      activity.assignedEngineers?.some(
        (engineer) => engineer.id === currentUserId
      )
    )
  }, [activities, assignmentOverride, currentUserId])
  const selectableActivityIds = useMemo(
    () => new Set(selectableActivities.map((activity) => activity.id)),
    [selectableActivities]
  )
  const selectedSelectableIds = useMemo(
    () =>
      selectedIds.filter((activityId) =>
        selectableActivityIds.has(activityId)
      ),
    [selectableActivityIds, selectedIds]
  )

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  if (!canSubmitProgress) return null

  return (
    <div className='space-y-3 rounded-md border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm font-semibold'>Bulk Progress Submission</p>
        <p className='text-xs text-muted-foreground'>
          Select multiple activities and submit one progress value.
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
            {selectableActivities.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className='p-3 text-center text-xs text-muted-foreground'
                >
                  No assigned activities available
                </td>
              </tr>
            )}
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
                  {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                  {activity.name}
                </td>
                <td className='p-2 text-right font-mono text-xs'>
                  {activity.pctComplete}%
                  <span
                    className='block font-sans text-[10px] text-muted-foreground'
                    data-testid={`uat-bulk-progress-source-${activity.id}`}
                  >
                    {progressSourceOf(activity) ?? '— No approved progress yet'}
                  </span>
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
          disabled={saving || selectedSelectableIds.length === 0}
          onClick={async () => {
            setSaving(true)
            try {
              await apiClient.post(
                `/projects/${projectId}/activities/bulk-progress`,
                {
                  updates: selectedSelectableIds.map((activityId) => ({
                    activityId,
                    pctComplete,
                  })),
                }
              )

              toast.success('Bulk progress submitted')
              setSelectedIds([])

              await Promise.all([
                qc.invalidateQueries({ queryKey: ['schedule', projectId] }),
                qc.invalidateQueries({ queryKey: ['activities', projectId] }),
                qc.invalidateQueries({
                  queryKey: ['progress-submissions', projectId],
                }),
                qc.invalidateQueries({ queryKey: ['ev-report', projectId] }),
              ])
            } catch (error) {
              toast.error(
                errorCodeFrom(error) === 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED'
                  ? 'Only assigned users can submit progress for selected activities'
                  : 'Failed to submit progress in bulk'
              )
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Submitting...' : 'Submit Selected'}
        </Button>
      </div>
    </div>
  )
}
