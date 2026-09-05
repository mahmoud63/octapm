import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useProjectCostCodes } from '@/features/cost/hooks/use-budget'
import { useLocations } from '@/features/locations/hooks/use-locations'
import {
  TIME_TYPE_LABEL,
  useDeleteTimesheet,
  useTimesheet,
  useTimesheetTransition,
  useUpdateTimesheet,
  useWorkers,
  type TimeEntryPayload,
  type TimeType,
  type TimesheetStatus,
} from '../hooks/use-timesheets'

export type ActivityOption = {
  id: string
  name: string
  wbsCode?: string | null
  activityCode?: string | null
}

const NONE = '__none__'

export const STATUS_CLASS: Record<TimesheetStatus, string> = {
  draft: 'border-slate-300 text-slate-700 dark:text-slate-200',
  submitted: 'border-blue-300 text-blue-700 dark:text-blue-200',
  approved: 'border-emerald-300 text-emerald-700 dark:text-emerald-200',
  rejected: 'border-rose-300 text-rose-700 dark:text-rose-200',
}

type Row = {
  key: string
  workerId: string
  activityId: string
  costCodeId: string
  locationId: string
  timeType: TimeType
  hours: string
  notes: string
}

const activityLabel = (activity: ActivityOption) =>
  `${activity.activityCode || activity.wbsCode ? `${activity.activityCode || activity.wbsCode} · ` : ''}${activity.name}`

const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })

/**
 * One day's timesheet: entries per worker with activity, cost code,
 * location, time type and hours; save while draft / rejected; submit,
 * approve (posts labour cost), return or reopen per permission.
 */
export function TimesheetEditorDialog({
  projectId,
  timesheetId,
  activities,
  open,
  onOpenChange,
}: {
  projectId: string
  timesheetId: string | null
  activities: ActivityOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: sheet, isLoading } = useTimesheet(
    projectId,
    open ? timesheetId : null
  )
  const { data: workers } = useWorkers(projectId)
  const { data: costCodes } = useProjectCostCodes(projectId)
  const { data: locations } = useLocations(projectId, { enabled: open })
  const update = useUpdateTimesheet(projectId)
  const transition = useTimesheetTransition(projectId)
  const remove = useDeleteTimesheet(projectId)
  const canUpdate = useCanPerform('timesheet', 'update')
  const canSubmit = useCanPerform('timesheet', 'submit', 'timesheet.submit')
  const canApprove = useCanPerform('timesheet', 'approve', 'timesheet.approve')
  const canReopen = useCanPerform('timesheet', 'approve', 'timesheet.reopen')
  const canDelete = useCanPerform('timesheet', 'delete')

  const [rows, setRows] = useState<Row[]>([])
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [addWorkerId, setAddWorkerId] = useState('')

  useEffect(() => {
    if (!sheet) return
    setRows(
      (sheet.entries ?? []).map((entry, index) => ({
        key: entry.id || String(index),
        workerId: entry.workerId,
        activityId: entry.activityId ?? '',
        costCodeId: entry.costCodeId ?? '',
        locationId: entry.locationId ?? '',
        timeType: entry.timeType,
        hours: String(entry.hours),
        notes: entry.notes ?? '',
      }))
    )
    setNotes(sheet.notes ?? '')
    setDirty(false)
    setRejecting(false)
    setRejectReason('')
  }, [sheet])

  const editable =
    Boolean(sheet) &&
    canUpdate &&
    (sheet?.status === 'draft' || sheet?.status === 'rejected')
  const workerOptions = workers?.items ?? []
  const workerById = useMemo(
    () => new Map(workerOptions.map((worker) => [worker.id, worker])),
    [workerOptions]
  )
  const costCodeOptions = (costCodes?.items ?? []).filter(
    (code) => code.status === 'active'
  )
  const locationOptions = locations?.items ?? []
  const totals = useMemo(() => {
    let regular = 0
    let overtime = 0
    for (const row of rows) {
      const hours = Number(row.hours) || 0
      if (row.timeType === 'regular') regular += hours
      else overtime += hours
    }
    return { regular, overtime, total: regular + overtime }
  }, [rows])
  const missingActivity = rows.filter((row) => !row.activityId).length

  const patch = (key: string, changes: Partial<Row>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...changes } : row))
    )
    setDirty(true)
  }

  const addRow = (workerId: string) => {
    if (!workerId) return
    const last = rows[rows.length - 1]
    setRows((current) => [
      ...current,
      {
        key: `new-${Date.now()}-${current.length}`,
        workerId,
        activityId: last?.activityId ?? '',
        costCodeId: last?.costCodeId ?? '',
        locationId: last?.locationId ?? '',
        timeType: 'regular',
        hours: '8',
        notes: '',
      },
    ])
    setDirty(true)
    setAddWorkerId('')
  }

  const payloadEntries = (): TimeEntryPayload[] =>
    rows.map((row) => ({
      workerId: row.workerId,
      activityId: row.activityId || null,
      costCodeId: row.costCodeId || null,
      locationId: row.locationId || null,
      timeType: row.timeType,
      hours: Number(row.hours) || 0,
      notes: row.notes.trim() || null,
    }))

  const save = async () => {
    if (!sheet) return null
    try {
      const saved = await update.mutateAsync({
        timesheetId: sheet.id,
        notes: notes.trim() || null,
        entries: payloadEntries(),
      })
      setDirty(false)
      toast.success('Timesheet saved')
      return saved
    } catch (error) {
      toast.error(getServerErrorMessage(error))
      return null
    }
  }

  const act = async (
    action: 'submit' | 'approve' | 'reject' | 'reopen',
    reason?: string
  ) => {
    if (!sheet) return
    if (dirty && editable) {
      const saved = await save()
      if (!saved) return
    }
    try {
      const result = await transition.mutateAsync({
        timesheetId: sheet.id,
        action,
        reason,
      })
      toast.success(
        action === 'submit'
          ? 'Submitted for approval'
          : action === 'approve'
            ? `Approved — labour cost ${money(result.totalCost)} posted`
            : action === 'reject'
              ? 'Returned to the submitter'
              : 'Reopened — posted cost reversed'
      )
      setRejecting(false)
      if (action === 'approve' || action === 'reject') onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const busy = update.isPending || transition.isPending || remove.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'
        data-testid='uat-timesheet-editor'
      >
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            Timesheet
            {sheet && (
              <>
                <span className='font-mono text-base'>{sheet.date}</span>
                {sheet.crew && (
                  <span className='text-base'>· {sheet.crew.name}</span>
                )}
                <Badge variant='outline' className={STATUS_CLASS[sheet.status]}>
                  {sheet.status}
                </Badge>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            Hours per worker on a schedule activity. Approval snapshots each
            worker&apos;s rate and posts the labour cost to the activity and the
            cost code&apos;s labour budget.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !sheet ? (
          <div className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading…
          </div>
        ) : (
          <div className='space-y-3'>
            {sheet.status === 'rejected' && sheet.rejectionReason && (
              <p className='rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'>
                Returned: {sheet.rejectionReason}
              </p>
            )}

            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-2 py-1 text-left'>Worker</th>
                    <th className='px-2 py-1 text-left'>Activity</th>
                    <th className='px-2 py-1 text-left'>Cost code</th>
                    <th className='px-2 py-1 text-left'>Location</th>
                    <th className='px-2 py-1 text-left'>Type</th>
                    <th className='px-2 py-1 text-right'>Hours</th>
                    {sheet.status === 'approved' && (
                      <th className='px-2 py-1 text-right'>Amount</th>
                    )}
                    <th className='px-2 py-1 text-left'>Notes</th>
                    {editable && <th className='px-2 py-1' />}
                  </tr>
                </thead>
                <tbody data-testid='uat-timesheet-rows'>
                  {rows.map((row) => {
                    const worker = workerById.get(row.workerId)
                    const entry = sheet.entries?.find(
                      (item) => item.id === row.key
                    )
                    return (
                      <tr key={row.key} className='border-t align-top'>
                        <td className='px-2 py-1'>
                          <div className='font-medium'>
                            {worker?.name ?? entry?.worker?.name ?? 'Worker'}
                          </div>
                          <div className='text-xs text-muted-foreground'>
                            {worker?.trade ?? entry?.worker?.trade ?? ''}
                          </div>
                        </td>
                        <td className='px-2 py-1'>
                          {editable ? (
                            <Select
                              value={row.activityId || NONE}
                              onValueChange={(value) =>
                                patch(row.key, {
                                  activityId: value === NONE ? '' : value,
                                })
                              }
                            >
                              <SelectTrigger
                                className={cn(
                                  'h-8 w-56',
                                  !row.activityId && 'border-amber-400'
                                )}
                              >
                                <SelectValue placeholder='Activity' />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— none —</SelectItem>
                                {activities.map((activity) => (
                                  <SelectItem
                                    key={activity.id}
                                    value={activity.id}
                                  >
                                    {activityLabel(activity)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span>{entry?.activity?.name ?? '—'}</span>
                          )}
                        </td>
                        <td className='px-2 py-1'>
                          {editable ? (
                            <Select
                              value={row.costCodeId || NONE}
                              onValueChange={(value) =>
                                patch(row.key, {
                                  costCodeId: value === NONE ? '' : value,
                                })
                              }
                            >
                              <SelectTrigger className='h-8 w-40'>
                                <SelectValue placeholder='Cost code' />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— none —</SelectItem>
                                {costCodeOptions.map((code) => (
                                  <SelectItem
                                    key={code.costCodeId}
                                    value={code.costCodeId}
                                  >
                                    {code.code} {code.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className='font-mono text-xs'>
                              {entry?.costCode?.code ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className='px-2 py-1'>
                          {editable ? (
                            <Select
                              value={row.locationId || NONE}
                              onValueChange={(value) =>
                                patch(row.key, {
                                  locationId: value === NONE ? '' : value,
                                })
                              }
                            >
                              <SelectTrigger className='h-8 w-36'>
                                <SelectValue placeholder='Location' />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— none —</SelectItem>
                                {locationOptions.map((location) => (
                                  <SelectItem
                                    key={location.id}
                                    value={location.id}
                                  >
                                    {location.fullName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span>{entry?.location?.name ?? '—'}</span>
                          )}
                        </td>
                        <td className='px-2 py-1'>
                          {editable ? (
                            <Select
                              value={row.timeType}
                              onValueChange={(value) =>
                                patch(row.key, { timeType: value as TimeType })
                              }
                            >
                              <SelectTrigger className='h-8 w-32'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(
                                  Object.keys(TIME_TYPE_LABEL) as TimeType[]
                                ).map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {TIME_TYPE_LABEL[type]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span>{TIME_TYPE_LABEL[row.timeType]}</span>
                          )}
                        </td>
                        <td className='px-2 py-1 text-right'>
                          {editable ? (
                            <Input
                              type='number'
                              min={0}
                              max={24}
                              step={0.25}
                              className='h-8 w-20 text-right'
                              value={row.hours}
                              onChange={(event) =>
                                patch(row.key, { hours: event.target.value })
                              }
                            />
                          ) : (
                            <span className='tabular-nums'>{row.hours}</span>
                          )}
                        </td>
                        {sheet.status === 'approved' && (
                          <td className='px-2 py-1 text-right tabular-nums'>
                            {money(entry?.amount)}
                          </td>
                        )}
                        <td className='px-2 py-1'>
                          {editable ? (
                            <Input
                              className='h-8 w-40'
                              value={row.notes}
                              onChange={(event) =>
                                patch(row.key, { notes: event.target.value })
                              }
                            />
                          ) : (
                            <span className='text-xs text-muted-foreground'>
                              {row.notes}
                            </span>
                          )}
                        </td>
                        {editable && (
                          <td className='px-2 py-1'>
                            <button
                              type='button'
                              className='text-destructive'
                              title='Remove'
                              onClick={() => {
                                setRows((current) =>
                                  current.filter((item) => item.key !== row.key)
                                )
                                setDirty(true)
                              }}
                            >
                              <Trash2 className='h-4 w-4' />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className='px-2 py-3 text-center text-muted-foreground'
                      >
                        No entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className='bg-muted/30 text-sm'>
                  <tr>
                    <td className='px-2 py-1 font-medium' colSpan={5}>
                      {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} ·
                      regular {totals.regular} h · overtime {totals.overtime} h
                    </td>
                    <td className='px-2 py-1 text-right font-medium tabular-nums'>
                      {totals.total}
                    </td>
                    {sheet.status === 'approved' && (
                      <td className='px-2 py-1 text-right font-medium tabular-nums'>
                        {money(sheet.totalCost)}
                      </td>
                    )}
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {editable && (
              <div className='flex flex-wrap items-end gap-2'>
                <div className='space-y-1'>
                  <Label>Add a worker</Label>
                  <Select value={addWorkerId} onValueChange={addRow}>
                    <SelectTrigger
                      className='w-64'
                      data-testid='uat-timesheet-add-worker'
                    >
                      <SelectValue placeholder='Pick a worker' />
                    </SelectTrigger>
                    <SelectContent>
                      {workerOptions
                        .filter((worker) => worker.status === 'active')
                        .map((worker) => (
                          <SelectItem key={worker.id} value={worker.id}>
                            {worker.name}
                            {worker.trade ? ` · ${worker.trade}` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Plus className='mb-2 h-4 w-4 text-muted-foreground' />
                <span className='mb-2 text-xs text-muted-foreground'>
                  A worker can appear several times (one row per activity or
                  time type).
                </span>
              </div>
            )}

            <div className='space-y-1'>
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value)
                  setDirty(true)
                }}
                disabled={!editable}
                rows={2}
              />
            </div>

            {missingActivity > 0 && editable && (
              <p className='text-xs text-amber-700 dark:text-amber-300'>
                {missingActivity} entr
                {missingActivity === 1 ? 'y has' : 'ies have'} no activity —
                every entry needs one before submission.
              </p>
            )}

            {rejecting && (
              <div className='space-y-1 rounded-md border p-3'>
                <Label>Why is it returned?</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={2}
                />
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    variant='destructive'
                    disabled={!rejectReason.trim() || busy}
                    onClick={() => act('reject', rejectReason.trim())}
                    data-testid='uat-timesheet-reject-confirm'
                  >
                    Return timesheet
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => setRejecting(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className='flex flex-wrap items-center gap-2'>
              {editable && (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={!dirty || busy}
                  onClick={save}
                  data-testid='uat-timesheet-save'
                >
                  <Save className='mr-2 h-4 w-4' /> Save
                </Button>
              )}
              {editable && canSubmit && (
                <Button
                  size='sm'
                  disabled={busy || rows.length === 0}
                  onClick={() => act('submit')}
                  data-testid='uat-timesheet-submit'
                >
                  <Send className='mr-2 h-4 w-4' /> Submit for approval
                </Button>
              )}
              {sheet.status === 'submitted' && canApprove && (
                <>
                  <Button
                    size='sm'
                    disabled={busy}
                    onClick={() => act('approve')}
                    data-testid='uat-timesheet-approve'
                  >
                    <CheckCircle2 className='mr-2 h-4 w-4' /> Approve and post
                    cost
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                    data-testid='uat-timesheet-reject'
                  >
                    <XCircle className='mr-2 h-4 w-4' /> Return
                  </Button>
                </>
              )}
              {(sheet.status === 'approved' || sheet.status === 'submitted') &&
                canReopen && (
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={busy}
                    onClick={() =>
                      act(
                        'reopen',
                        sheet.status === 'approved'
                          ? 'reopened for correction'
                          : undefined
                      )
                    }
                    data-testid='uat-timesheet-reopen'
                  >
                    <RotateCcw className='mr-2 h-4 w-4' /> Reopen
                  </Button>
                )}
              {sheet.status === 'draft' && canDelete && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='ml-auto text-destructive'
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Delete this draft timesheet?')) return
                    remove.mutate(sheet.id, {
                      onSuccess: () => onOpenChange(false),
                      onError: (error) =>
                        toast.error(getServerErrorMessage(error)),
                    })
                  }}
                >
                  <Trash2 className='mr-2 h-4 w-4' /> Delete
                </Button>
              )}
              {busy && <Loader2 className='h-4 w-4 animate-spin' />}
            </div>

            {sheet.status === 'approved' && (
              <p className='text-xs text-muted-foreground'>
                Approved{' '}
                {sheet.approvedAt
                  ? new Date(sheet.approvedAt).toLocaleString()
                  : ''}{' '}
                · labour cost {money(sheet.totalCost)} posted to{' '}
                {
                  new Set(
                    (sheet.entries ?? [])
                      .map((entry) => entry.activityId)
                      .filter(Boolean)
                  ).size
                }{' '}
                activit
                {new Set(
                  (sheet.entries ?? [])
                    .map((entry) => entry.activityId)
                    .filter(Boolean)
                ).size === 1
                  ? 'y'
                  : 'ies'}
                .
              </p>
            )}

            <HistoryPanel
              projectId={projectId}
              entityType='timesheet'
              entityId={sheet.id}
              title='History'
              limit={6}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
