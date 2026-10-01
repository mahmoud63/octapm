import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import type { ActivityProgressExtras, ScheduleActivity } from '../data/schema'
import { withRegisterProgress } from '../lib/register-progress'

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

/** The server's own sentence for a refusal, when it sent one. */
const errorMessageFrom = (error: unknown) =>
  (
    error as {
      response?: { data?: { error?: { message?: string } } }
    }
  )?.response?.data?.error?.message

/** The update of the batch a refusal came from (the server's details.batch). */
const errorBatchFrom = (error: unknown) =>
  (
    error as {
      response?: {
        data?: {
          error?: {
            details?: {
              batch?: { index?: number; activityId?: string; written?: number }
            }
          }
        }
      }
    }
  )?.response?.data?.error?.details?.batch

// PC-6 (owner rule: the activity's progress method is respected). This screen
// sends one percentage for every selected activity; POST
// /activities/bulk-progress refuses the whole batch — nothing written — when
// one of them is measured by quantity (a percentage is not a quantity). So
// such an activity is listed, never offered: its checkbox is disabled, with
// the reason and the way to the Progress tab, where installed quantities are
// put forward.
//
// The method is the one the register sends (GET /projects/:id/activities):
// the activity's configured method, else the method its latest official
// figure was approved under, else percent — the server's own effective
// method. The schedule payload does not carry it, so the screen reads the
// register; an activity whose method has not been read is not offered either
// (never assumed to be percent).
//
// The milestone method is respected like quantity (2026-10-01): the server
// refuses a bare percentage against configured weighted milestones (400
// MILESTONES_REQUIRED), and an inspection is measured by its result. So a
// percentage is offered only for an activity measured by percent or manual;
// every other method is listed disabled with its own reason.
const QUANTITY_METHOD_REASON =
  'Measured by quantity — record installed quantities in the daily log or the Progress tab'
const MILESTONE_METHOD_REASON =
  'Measured by weighted milestones — mark the milestones complete in the Progress tab'
const INSPECTION_METHOD_REASON =
  'Measured by inspection — record the inspection result in the Progress tab'
const METHOD_NOT_READ_REASON =
  'Progress method not read from the server yet — not offered for a percentage update'
const PERCENTAGE_METHODS = new Set(['percent', 'manual'])

const effectiveMethodOf = (activity: ScheduleActivity): string | null =>
  activity.progressMethodConfig?.method || activity.progressMethod || null

/** Why this activity takes no percentage update here; null when it does. */
const percentageRefusalOf = (activity: ScheduleActivity): string | null => {
  const method = effectiveMethodOf(activity)
  if (method === 'quantity') return QUANTITY_METHOD_REASON
  if (!method) return METHOD_NOT_READ_REASON
  if (PERCENTAGE_METHODS.has(method)) return null
  if (method === 'weighted_milestone') return MILESTONE_METHOD_REASON
  if (method === 'inspection') return INSPECTION_METHOD_REASON
  return `Measured by ${method} — not offered for a percentage update`
}

const activityLabel = (activity: ScheduleActivity) =>
  `${activity.wbsCode ? `${activity.wbsCode} - ` : ''}${activity.name}`

export function BulkProgressUpdate({
  projectId,
  activities: scheduled,
}: Props) {
  const canSubmitProgress = useCanPerform(
    'progress',
    'submit',
    'submission.submit'
  )
  const currentUser = useAuthStore((state) => state.auth.user)
  const qc = useQueryClient()
  // The register's progress fields (method, assignment, source) over the
  // schedule's rows — the Progress tab's own read and merge.
  const registerQuery = useQuery<Array<Record<string, unknown>>>({
    queryKey: ['activities', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/activities`)
        .then((r) => r.data.data as Array<Record<string, unknown>>),
    enabled: !!projectId && canSubmitProgress,
  })
  const activities = useMemo(
    () => withRegisterProgress(scheduled, registerQuery.data),
    [scheduled, registerQuery.data]
  )
  const progressTabLink = workspaceLink(
    `/projects/${projectId}/schedule/progress`
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pctComplete, setPctComplete] = useState(0)
  const [saving, setSaving] = useState(false)
  // The server's refusal of the last batch: nothing of it was saved.
  const [refusal, setRefusal] = useState<{
    activityId: string | null
    text: string
  } | null>(null)
  const currentUserId = currentUser?.id ?? ''
  const currentUserRole = currentUser?.role ?? ''
  const assignmentOverride = useMemo(
    () => isProgressAssignmentOverride(currentUserRole),
    [currentUserRole]
  )

  const listedActivities = useMemo(() => {
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
  // Offered for a percentage: listed, and measured by percent or manual.
  const selectableActivityIds = useMemo(
    () =>
      new Set(
        listedActivities
          .filter((activity) => percentageRefusalOf(activity) === null)
          .map((activity) => activity.id)
      ),
    [listedActivities]
  )
  const selectedSelectableIds = useMemo(
    () =>
      selectedIds.filter((activityId) => selectableActivityIds.has(activityId)),
    [selectableActivityIds, selectedIds]
  )

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  if (!canSubmitProgress) return null

  return (
    <div
      className='space-y-3 rounded-md border p-3'
      data-testid='uat-bulk-progress'
    >
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
            {listedActivities.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className='p-3 text-center text-xs text-muted-foreground'
                >
                  No assigned activities available
                </td>
              </tr>
            )}
            {listedActivities.map((activity) => {
              const notOffered = selectableActivityIds.has(activity.id)
                ? null
                : percentageRefusalOf(activity)
              return (
                <tr
                  key={activity.id}
                  className='border-b'
                  data-testid={`uat-bulk-progress-row-${activity.id}`}
                  data-progress-method={effectiveMethodOf(activity) ?? ''}
                  data-bulk-selectable={notOffered ? 'false' : 'true'}
                >
                  <td className='p-2'>
                    <input
                      type='checkbox'
                      data-testid={`uat-bulk-progress-select-${activity.id}`}
                      aria-label={`Select ${activityLabel(activity)}`}
                      disabled={notOffered !== null}
                      title={notOffered ?? undefined}
                      checked={
                        notOffered === null && selectedIds.includes(activity.id)
                      }
                      onChange={() => toggle(activity.id)}
                    />
                  </td>
                  <td className='p-2 text-xs'>
                    <span className={notOffered ? 'text-muted-foreground' : ''}>
                      {activityLabel(activity)}
                    </span>
                    {notOffered && (
                      <span
                        className='block text-[10px] text-muted-foreground'
                        data-testid={`uat-bulk-progress-disabled-${activity.id}`}
                      >
                        {notOffered}
                        {effectiveMethodOf(activity) !== null &&
                          progressTabLink && (
                            <>
                              {' · '}
                              <Link
                                to='/projects/$projectId'
                                params={{
                                  projectId: progressTabLink.projectId,
                                }}
                                search={progressTabLink.search}
                                className='underline underline-offset-2'
                                data-testid={`uat-bulk-progress-open-progress-tab-${activity.id}`}
                              >
                                Open the Progress tab
                              </Link>
                            </>
                          )}
                      </span>
                    )}
                  </td>
                  <td className='p-2 text-right font-mono text-xs'>
                    {activity.pctComplete}%
                    <span
                      className='block font-sans text-[10px] text-muted-foreground'
                      data-testid={`uat-bulk-progress-source-${activity.id}`}
                    >
                      {progressSourceOf(activity) ??
                        '— No approved progress yet'}
                    </span>
                  </td>
                </tr>
              )
            })}
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
            data-testid='uat-bulk-progress-pct'
          />
          <p className='text-right font-mono text-xs'>{pctComplete}%</p>
        </div>

        <Button
          disabled={saving || selectedSelectableIds.length === 0}
          data-testid='uat-bulk-progress-submit'
          onClick={async () => {
            setSaving(true)
            setRefusal(null)
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
              const message =
                errorCodeFrom(error) === 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED'
                  ? 'Only assigned users can submit progress for selected activities'
                  : // The server names the activity's rule (PC-6: a percentage
                    // is not recorded against an activity measured by
                    // quantity).
                    (errorMessageFrom(error) ??
                    'Failed to submit progress in bulk')
              // The batch is one transaction: a refusal means nothing of it
              // was written, and details.batch names the update it came from
              // — an activity whose method changed under this screen. Nothing
              // is shown as saved: no success, the selection stays, and the
              // refusal names the activity.
              const batch = errorBatchFrom(error)
              const refused = batch?.activityId
                ? activities.find(
                    (activity) => activity.id === batch.activityId
                  )
                : undefined
              const answered = Boolean(
                (error as { response?: unknown })?.response
              )
              const text = [
                answered ? 'Nothing was saved.' : null,
                refused ? `${activityLabel(refused)}: ${message}` : message,
              ]
                .filter(Boolean)
                .join(' ')
              setRefusal({ activityId: batch?.activityId ?? null, text })
              toast.error(text)
              // Read the register again: the refused activity's method is
              // then the server's, and it is no longer offered.
              await qc.invalidateQueries({
                queryKey: ['activities', projectId],
              })
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Submitting...' : 'Submit Selected'}
        </Button>
      </div>

      {refusal && (
        <p
          role='alert'
          className='rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive'
          data-testid='uat-bulk-progress-refusal'
          data-activity-id={refusal.activityId ?? ''}
        >
          {refusal.text}
        </p>
      )}
    </div>
  )
}
