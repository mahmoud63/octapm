import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Save,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import {
  projectSetupReadinessKey,
  useProjectSetupReadiness,
} from '@/features/projects/hooks/use-projects'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  ProgressMethod,
  ProgressSubmission,
  ScheduleActivity,
} from '../data/schema'

interface Props {
  activities: ScheduleActivity[]
  projectId: string
}

type SubmissionRow = NonNullable<ProgressSubmission>

type RowDraft = {
  method: ProgressMethod
  pctComplete: number
  quantityComplete: string
  quantityPlanned: string
  quantityUnit: string
  evidenceRequired: boolean
  evidenceUrl: string
  inspectionStatus: string
  milestoneChecks: Record<string, boolean>
}

const METHOD_OPTIONS: ProgressMethod[] = [
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
]

const METHOD_LABELS: Record<ProgressMethod, string> = {
  percent: 'Percent',
  quantity: 'Quantity',
  weighted_milestone: 'Weighted Milestones',
  inspection: 'Inspection',
  manual: 'Manual',
}

const INSPECTION_STATUSES = ['pending', 'passed', 'failed']

const DEFAULT_MILESTONES = [
  { id: 'start', name: 'Started', weight: 20 },
  { id: 'install', name: 'Installed', weight: 50 },
  { id: 'finish', name: 'Finished', weight: 30 },
]

const fmtUSD = (n: number) =>
  '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const today = () => new Date().toISOString().slice(0, 10)

const asProgressMethod = (
  method: string | null | undefined
): ProgressMethod => {
  if (method === 'quantity') return 'quantity'
  if (method === 'weighted_milestone' || method === 'milestone') {
    return 'weighted_milestone'
  }
  if (method === 'inspection') return 'inspection'
  if (method === 'manual') return 'manual'
  return 'percent'
}

const milestoneRowsFor = (activity: ScheduleActivity) => {
  const rows = activity.progressMethodConfig?.milestoneWeights
  if (Array.isArray(rows) && rows.length) {
    return rows.map((row, index) => {
      const item = row as { id?: string; name?: string; weight?: number }
      return {
        id: item.id || item.name || String(index),
        name: item.name || item.id || `Milestone ${index + 1}`,
        weight: Number(item.weight || 0),
      }
    })
  }
  return DEFAULT_MILESTONES
}

const buildDefaultDraft = (activity: ScheduleActivity): RowDraft => ({
  method: asProgressMethod(
    activity.progressMethodConfig?.method || activity.progressMethod
  ),
  pctComplete:
    activity.pendingProgress?.pctComplete ?? activity.pctComplete ?? 0,
  quantityComplete: String(activity.pendingProgress?.quantityComplete ?? ''),
  quantityPlanned: String(
    activity.progressMethodConfig?.plannedQuantity ??
      activity.pendingProgress?.quantityPlanned ??
      ''
  ),
  quantityUnit:
    activity.progressMethodConfig?.quantityUnit ??
    activity.pendingProgress?.quantityUnit ??
    '',
  evidenceRequired: Boolean(activity.progressMethodConfig?.evidenceRequired),
  evidenceUrl: '',
  inspectionStatus: activity.pendingProgress?.inspectionStatus ?? 'pending',
  milestoneChecks: {},
})

export function ProgressTab({ activities, projectId }: Props) {
  const queryClient = useQueryClient()
  const { data: setupReadiness } = useProjectSetupReadiness(projectId)
  const canConfigureProgressMethod = useCanPerform(
    'progress',
    'update',
    'method.configure'
  )
  const canSubmitProgress = useCanPerform(
    'progress',
    'submit',
    'submission.submit'
  )
  const canApproveProgress = useCanPerform(
    'progress',
    'approve',
    'submission.approve'
  )
  const canRejectProgress = useCanPerform(
    'progress',
    'approve',
    'submission.reject'
  )
  const canSubmitDailyReport = useCanPerform(
    'progress',
    'submit',
    'daily_report.submit'
  )
  const [drafts, setDrafts] = useState<Record<string, Partial<RowDraft>>>({})
  const [dailyActivityId, setDailyActivityId] = useState(
    activities.find((activity) => !activity.isMilestone)?.id ?? ''
  )
  const [dailyDate, setDailyDate] = useState(today())
  const [dailyPct, setDailyPct] = useState(0)
  const [dailyWorkers, setDailyWorkers] = useState('')
  const [dailyEquipmentHours, setDailyEquipmentHours] = useState('')
  const [dailyMaterial, setDailyMaterial] = useState('')
  const [dailyMaterialQty, setDailyMaterialQty] = useState('')
  const [dailyPhotoUrl, setDailyPhotoUrl] = useState('')
  const [dailyNotes, setDailyNotes] = useState('')

  const selectableActivities = useMemo(
    () => activities.filter((activity) => !activity.isMilestone),
    [activities]
  )

  const pendingQuery = useQuery<SubmissionRow[]>({
    queryKey: ['progress-submissions', projectId, 'submitted'],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/activities/progress-submissions`, {
          params: { status: 'submitted' },
        })
        .then((r) => r.data.data as SubmissionRow[]),
    enabled: !!projectId,
  })

  const refreshProgress = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['activities', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['ev-report', projectId] }),
      queryClient.invalidateQueries({
        queryKey: ['progress-submissions', projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ['daily-reports', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] }),
      queryClient.invalidateQueries({
        queryKey: projectSetupReadinessKey(projectId),
      }),
    ])
  }

  const saveMethod = useMutation({
    mutationFn: ({
      activity,
      draft,
    }: {
      activity: ScheduleActivity
      draft: RowDraft
    }) =>
      apiClient
        .put(
          `/projects/${projectId}/activities/${activity.id}/progress-method`,
          {
            method: draft.method,
            plannedQuantity:
              draft.quantityPlanned.trim() === ''
                ? null
                : Number(draft.quantityPlanned),
            quantityUnit: draft.quantityUnit || null,
            milestoneWeights:
              draft.method === 'weighted_milestone'
                ? milestoneRowsFor(activity)
                : null,
            evidenceRequired: draft.evidenceRequired,
          }
        )
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Progress method saved')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to save progress method'),
  })

  const submitProgress = useMutation({
    mutationFn: ({
      activity,
      draft,
    }: {
      activity: ScheduleActivity
      draft: RowDraft
    }) => {
      const milestones = milestoneRowsFor(activity).map((row) => ({
        ...row,
        complete: Boolean(draft.milestoneChecks[row.id]),
      }))
      const payload = {
        method: draft.method,
        pctComplete: draft.pctComplete,
        quantityComplete:
          draft.quantityComplete.trim() === ''
            ? undefined
            : Number(draft.quantityComplete),
        quantityPlanned:
          draft.quantityPlanned.trim() === ''
            ? undefined
            : Number(draft.quantityPlanned),
        quantityUnit: draft.quantityUnit || undefined,
        inspectionStatus: draft.inspectionStatus,
        milestones:
          draft.method === 'weighted_milestone' ? milestones : undefined,
        evidence: draft.evidenceUrl.trim()
          ? { photos: [{ url: draft.evidenceUrl.trim() }] }
          : undefined,
      }

      return apiClient
        .post(
          `/projects/${projectId}/activities/${activity.id}/progress`,
          payload
        )
        .then((r) => r.data.data)
    },
    onSuccess: async () => {
      toast.success('Progress submitted')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to submit progress'),
  })

  const approveSubmission = useMutation({
    mutationFn: (submission: SubmissionRow) =>
      apiClient
        .post(
          `/projects/${projectId}/activities/${submission.activityId}/progress-submissions/${submission.id}/approve`
        )
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Progress approved')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to approve progress'),
  })

  const rejectSubmission = useMutation({
    mutationFn: ({
      submission,
      reason,
    }: {
      submission: SubmissionRow
      reason: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/activities/${submission.activityId}/progress-submissions/${submission.id}/reject`,
          { reason }
        )
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Progress rejected')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to reject progress'),
  })

  const createDailyReport = useMutation({
    mutationFn: () =>
      apiClient
        .post(`/projects/${projectId}/daily-reports`, {
          activityId: dailyActivityId,
          date: dailyDate,
          pctProgress: dailyPct,
          manpower: dailyWorkers
            ? [{ trade: 'crew', workers: Number(dailyWorkers), hours: 8 }]
            : [],
          equipment: dailyEquipmentHours
            ? [{ name: 'site equipment', hours: Number(dailyEquipmentHours) }]
            : [],
          materials: dailyMaterial
            ? [
                {
                  name: dailyMaterial,
                  qty: Number(dailyMaterialQty || 0),
                  unit: 'unit',
                },
              ]
            : [],
          photos: dailyPhotoUrl ? [{ url: dailyPhotoUrl }] : [],
          notes: dailyNotes,
        })
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Daily report submitted')
      setDailyPct(0)
      setDailyWorkers('')
      setDailyEquipmentHours('')
      setDailyMaterial('')
      setDailyMaterialQty('')
      setDailyPhotoUrl('')
      setDailyNotes('')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to submit daily report'),
  })

  const ev = useMemo(() => {
    const totalBudget = selectableActivities.reduce(
      (sum, a) => sum + (a.budget || 0),
      0
    )
    const evValue = selectableActivities.reduce(
      (sum, a) => sum + ((a.pctComplete ?? 0) / 100) * (a.budget || 0),
      0
    )
    const pv = selectableActivities.reduce((sum, a) => {
      if (a.status === 'todo') return sum
      return sum + (a.budget || 0)
    }, 0)
    const ac = selectableActivities.reduce((sum, a) => {
      if (a.actualCost != null) return sum + a.actualCost
      return sum + ((a.pctComplete ?? 0) / 100) * (a.budget || 0) * 1.03
    }, 0)
    const missingActualCount = selectableActivities.filter(
      (a) => a.actualCost == null
    ).length
    const spi = pv > 0 ? evValue / pv : 1
    const cpi = ac > 0 ? evValue / ac : 1

    return { totalBudget, ev: evValue, pv, ac, spi, cpi, missingActualCount }
  }, [selectableActivities])

  const draftFor = (activity: ScheduleActivity): RowDraft => ({
    ...buildDefaultDraft(activity),
    ...drafts[activity.id],
  })

  const progressGate = setupReadiness?.gates.progress
  const progressBlockers = progressGate?.blockers ?? []

  const patchDraft = (activityId: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [activityId]: {
        ...prev[activityId],
        ...patch,
      },
    }))
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>SPI Est.</p>
          <p
            className={`text-xl font-bold ${ev.spi < 0.9 ? 'text-red-600' : 'text-green-600'}`}
          >
            {ev.spi.toFixed(2)}
          </p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>CPI Est.</p>
          <p
            className={`text-xl font-bold ${ev.cpi < 0.9 ? 'text-red-600' : 'text-green-600'}`}
          >
            {ev.cpi.toFixed(2)}
          </p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>EV Est.</p>
          <p className='text-xl font-bold'>{fmtUSD(ev.ev)}</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>PV Est.</p>
          <p className='text-xl font-bold'>{fmtUSD(ev.pv)}</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>AC Est.</p>
          <p className='text-xl font-bold'>{fmtUSD(ev.ac)}</p>
        </div>
      </div>

      {progressBlockers.length > 0 && (
        <div className='rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100'>
          <div className='flex flex-wrap items-start gap-2'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <div className='min-w-0 flex-1'>
              <p className='font-semibold'>Progress setup warnings</p>
              <p className='mt-1 text-xs opacity-90'>
                {progressGate?.message}
              </p>
              <ul className='mt-2 list-inside list-disc space-y-1 text-xs'>
                {progressBlockers.slice(0, 4).map((blocker) => (
                  <li key={`${blocker.stepKey}-${blocker.code}`}>
                    {blocker.stepLabel}: {blocker.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <AuditHistoryPanel
        projectId={projectId}
        entityType='progress_submission'
        title='Progress Approval History'
        limit={10}
      />

      <div className='rounded-md border'>
        <div className='flex flex-wrap items-center justify-between gap-2 border-b p-3'>
          <div>
            <p className='text-sm font-semibold'>Approval Queue</p>
            <p className='text-xs text-muted-foreground'>
              {pendingQuery.data?.length ?? 0} submitted
            </p>
          </div>
          <Badge variant='outline'>Approved progress drives official EV</Badge>
        </div>
        <div className='divide-y'>
          {(pendingQuery.data ?? []).length === 0 && (
            <p className='p-3 text-sm text-muted-foreground'>
              No pending progress.
            </p>
          )}
          {(pendingQuery.data ?? []).map((submission) => (
            <div
              key={submission.id}
              className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center'
            >
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>
                  {submission.activity?.wbsCode
                    ? `${submission.activity.wbsCode} - `
                    : ''}
                  {submission.activity?.name ?? submission.activityId}
                </p>
                <p className='text-xs text-muted-foreground'>
                  {METHOD_LABELS[submission.method]} - {submission.pctComplete}%
                  - {submission.source}
                </p>
              </div>
              {(canApproveProgress || canRejectProgress) && (
                <div className='flex gap-2'>
                  {canApproveProgress && (
                    <Button
                      size='sm'
                      onClick={() => approveSubmission.mutate(submission)}
                      disabled={approveSubmission.isPending}
                    >
                      <CheckCircle2 className='mr-1.5 h-4 w-4' />
                      Approve
                    </Button>
                  )}
                  {canRejectProgress && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        const reason = window.prompt('Rejection reason')
                        if (reason?.trim()) {
                          rejectSubmission.mutate({
                            submission,
                            reason: reason.trim(),
                          })
                        }
                      }}
                      disabled={rejectSubmission.isPending}
                    >
                      <XCircle className='mr-1.5 h-4 w-4' />
                      Reject
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className='divide-y rounded-md border'>
        {selectableActivities.map((activity) => {
          const draft = draftFor(activity)
          const milestones = milestoneRowsFor(activity)
          return (
            <div key={activity.id} className='space-y-3 p-3'>
              <div className='flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <p className='truncate text-sm font-medium'>
                      {activity.name}
                    </p>
                    <Badge variant='outline'>
                      {METHOD_LABELS[draft.method]}
                    </Badge>
                    {activity.pendingProgress && (
                      <Badge variant='secondary'>Pending</Badge>
                    )}
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {activity.category || '-'} - {activity.duration}d - Budget{' '}
                    {fmtUSD(activity.budget)} - Approved {activity.pctComplete}%
                  </p>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <Select
                    value={draft.method}
                    disabled={!canConfigureProgressMethod}
                    onValueChange={(value) =>
                      patchDraft(activity.id, {
                        method: value as ProgressMethod,
                      })
                    }
                  >
                    <SelectTrigger size='sm' className='w-44'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHOD_OPTIONS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {canConfigureProgressMethod && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => saveMethod.mutate({ activity, draft })}
                      disabled={saveMethod.isPending}
                    >
                      <Save className='mr-1.5 h-4 w-4' />
                      Save Method
                    </Button>
                  )}
                </div>
              </div>

              <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_160px] lg:items-end'>
                {draft.method === 'quantity' ? (
                  <div className='grid grid-cols-3 gap-2'>
                    <div>
                      <Label className='text-xs'>Complete Qty</Label>
                      <Input
                        type='number'
                        min={0}
                        value={draft.quantityComplete}
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            quantityComplete: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className='text-xs'>Planned Qty</Label>
                      <Input
                        type='number'
                        min={0}
                        value={draft.quantityPlanned}
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            quantityPlanned: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className='text-xs'>Unit</Label>
                      <Input
                        value={draft.quantityUnit}
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            quantityUnit: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                ) : draft.method === 'weighted_milestone' ? (
                  <div className='flex flex-wrap gap-3'>
                    {milestones.map((milestone) => (
                      <label
                        key={milestone.id}
                        className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'
                      >
                        <Checkbox
                          checked={Boolean(draft.milestoneChecks[milestone.id])}
                          onCheckedChange={(checked) =>
                            patchDraft(activity.id, {
                              milestoneChecks: {
                                ...draft.milestoneChecks,
                                [milestone.id]: Boolean(checked),
                              },
                            })
                          }
                        />
                        <span>
                          {milestone.name} - {milestone.weight}%
                        </span>
                      </label>
                    ))}
                  </div>
                ) : draft.method === 'inspection' ? (
                  <div className='grid grid-cols-2 gap-2'>
                    <div>
                      <Label className='text-xs'>Inspection</Label>
                      <Select
                        value={draft.inspectionStatus}
                        onValueChange={(value) =>
                          patchDraft(activity.id, { inspectionStatus: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INSPECTION_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className='text-xs'>Percent</Label>
                      <Input
                        type='number'
                        min={0}
                        max={100}
                        value={draft.pctComplete}
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            pctComplete: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label className='text-xs'>Progress %</Label>
                    <div className='flex items-center gap-3'>
                      <input
                        type='range'
                        min={0}
                        max={100}
                        step={1}
                        value={draft.pctComplete}
                        className='flex-1'
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            pctComplete: Number(e.target.value),
                          })
                        }
                      />
                      <span className='w-10 text-right font-mono text-sm'>
                        {draft.pctComplete}%
                      </span>
                    </div>
                  </div>
                )}

                <div>
                  <Label className='text-xs'>Photo URL</Label>
                  <Input
                    value={draft.evidenceUrl}
                    disabled={!canSubmitProgress}
                    onChange={(e) =>
                      patchDraft(activity.id, { evidenceUrl: e.target.value })
                    }
                  />
                  <label className='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
                    <Checkbox
                      checked={draft.evidenceRequired}
                      disabled={!canConfigureProgressMethod}
                      onCheckedChange={(checked) =>
                        patchDraft(activity.id, {
                          evidenceRequired: Boolean(checked),
                        })
                      }
                    />
                    Evidence required
                  </label>
                </div>

                {canSubmitProgress && (
                  <Button
                    onClick={() => submitProgress.mutate({ activity, draft })}
                    disabled={submitProgress.isPending}
                  >
                    <Send className='mr-1.5 h-4 w-4' />
                    Submit
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className='rounded-md border p-3'>
        <div className='mb-3 flex flex-wrap items-center gap-2'>
          <ClipboardCheck className='h-4 w-4 text-muted-foreground' />
          <p className='text-sm font-semibold'>Daily Site Report</p>
        </div>
        <div className='grid gap-3 md:grid-cols-4'>
          <div>
            <Label className='text-xs'>Activity</Label>
            <Select value={dailyActivityId} onValueChange={setDailyActivityId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectableActivities.map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                    {activity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className='text-xs'>Date</Label>
            <Input
              type='date'
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Progress %</Label>
            <Input
              type='number'
              min={0}
              max={100}
              value={dailyPct}
              onChange={(e) => setDailyPct(Number(e.target.value))}
            />
          </div>
          <div>
            <Label className='text-xs'>Workers</Label>
            <Input
              type='number'
              min={0}
              value={dailyWorkers}
              onChange={(e) => setDailyWorkers(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Equipment Hours</Label>
            <Input
              type='number'
              min={0}
              value={dailyEquipmentHours}
              onChange={(e) => setDailyEquipmentHours(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Material</Label>
            <Input
              value={dailyMaterial}
              onChange={(e) => setDailyMaterial(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Material Qty</Label>
            <Input
              type='number'
              min={0}
              value={dailyMaterialQty}
              onChange={(e) => setDailyMaterialQty(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Photo URL</Label>
            <Input
              value={dailyPhotoUrl}
              onChange={(e) => setDailyPhotoUrl(e.target.value)}
            />
          </div>
        </div>
        <div className='mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px] lg:items-end'>
          <div>
            <Label className='text-xs'>Notes</Label>
            <Textarea
              value={dailyNotes}
              onChange={(e) => setDailyNotes(e.target.value)}
              className='min-h-20'
            />
          </div>
          <Button
            disabled={
              !canSubmitDailyReport ||
              !dailyActivityId ||
              createDailyReport.isPending
            }
            onClick={() => createDailyReport.mutate()}
          >
            <Camera className='mr-1.5 h-4 w-4' />
            Submit Report
          </Button>
        </div>
      </div>

      <p className='text-xs text-muted-foreground'>
        Live estimate only. Total budget considered: {fmtUSD(ev.totalBudget)}.
        Missing actuals estimated for {ev.missingActualCount} activities;
        official reports use approved progress, cost records, and cutoff
        periods.
      </p>
    </div>
  )
}
