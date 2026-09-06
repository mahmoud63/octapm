import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRightToLine,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
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
  DialogFooter,
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
import { Switch } from '@/components/ui/switch'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  ITEM_STATUS_LABEL,
  LOOKAHEAD_STATUS_LABEL,
  VARIANCE_REASON_LABEL,
  WEEK_OPTIONS,
  downloadFile,
  useDeleteLookahead,
  useLookahead,
  useLookaheadAction,
  type Lookahead,
  type LookaheadItem,
  type LookaheadItemStatus,
  type LookaheadVarianceReason,
} from '../hooks/use-lookaheads'
import { LookaheadItemDialog } from './lookahead-item-dialog'
import {
  ITEM_BAR_CLASS,
  ITEM_STATUS_CLASS,
  LOOKAHEAD_STATUS_CLASS,
  addDaysKey,
  fmtDate,
  pct,
} from './lookahead-shared'

function RollForwardDialog({
  lookahead,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  lookahead: Lookahead
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: {
    startDate: string
    weeks: number
    archiveSource: boolean
  }) => void
  pending: boolean
}) {
  const [startDate, setStartDate] = useState(addDaysKey(lookahead.startDate, 7))
  const [weeks, setWeeks] = useState(lookahead.weeks)
  const [archiveSource, setArchiveSource] = useState(true)
  useEffect(() => {
    if (!open) return
    setStartDate(addDaysKey(lookahead.startDate, 7))
    setWeeks(lookahead.weeks)
    setArchiveSource(true)
  }, [open, lookahead.startDate, lookahead.weeks])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md' data-testid='uat-lookahead-roll'>
        <DialogHeader>
          <DialogTitle>Roll forward</DialogTitle>
          <DialogDescription>
            A new draft carrying the unfinished tasks — not-done tasks are
            re-planned from the new start with their reason noted, open
            constraints come along — then seeded with the activities newly due.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>New start</Label>
            <Input
              type='date'
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label>Length</Label>
            <Select
              value={String(weeks)}
              onValueChange={(value) => setWeeks(Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEK_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} weeks
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center justify-between rounded border px-3 py-2 sm:col-span-2'>
            <p className='text-sm'>Archive {lookahead.ref} afterwards</p>
            <Switch
              checked={archiveSource}
              onCheckedChange={setArchiveSource}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!startDate || pending}
            onClick={() => onSubmit({ startDate, weeks, archiveSource })}
            data-testid='uat-lookahead-roll-confirm'
          >
            {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Create next plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PpcCard({ lookahead }: { lookahead: Lookahead }) {
  const ppc = lookahead.summary.ppc
  const reasons = Object.entries(ppc.varianceReasons) as Array<
    [LookaheadVarianceReason, number]
  >
  return (
    <div className='rounded-md border' data-testid='uat-lookahead-ppc'>
      <div className='flex flex-wrap items-baseline gap-2 border-b px-3 py-2'>
        <p className='text-sm font-medium'>Percent plan complete</p>
        <p className='text-2xl font-bold tabular-nums'>{pct(ppc.ppc)}</p>
        <p className='text-xs text-muted-foreground'>
          {ppc.closedWeeks === 0
            ? 'no closed week yet — tasks are counted in the week they are due'
            : `${ppc.completed} of ${ppc.committed} tasks done in ${ppc.closedWeeks} closed week${ppc.closedWeeks === 1 ? '' : 's'}`}
        </p>
      </div>
      <div className='grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6'>
        {ppc.weeks.map((week) => (
          <div
            key={week.week}
            className={cn(
              'rounded border p-2',
              week.closed ? 'bg-muted/30' : 'border-dashed'
            )}
          >
            <p className='text-xs text-muted-foreground'>
              Week {week.week} · {fmtDate(week.start)}
              {week.closed ? '' : ' · open'}
            </p>
            <p className='text-lg font-semibold tabular-nums'>
              {pct(week.ppc)}
            </p>
            <p className='text-[11px] text-muted-foreground'>
              {week.completed}/{week.committed} done
              {week.notDone ? ` · ${week.notDone} not done` : ''}
            </p>
          </div>
        ))}
      </div>
      {reasons.length > 0 && (
        <div className='flex flex-wrap gap-1.5 border-t px-3 py-2'>
          <span className='text-xs text-muted-foreground'>Why not done:</span>
          {reasons
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => (
              <Badge key={reason} variant='outline' className='text-xs'>
                {VARIANCE_REASON_LABEL[reason] ?? reason} · {count}
              </Badge>
            ))}
        </div>
      )}
    </div>
  )
}

/** One lookahead: the weekly day grid, the actions and the PPC. */
export function LookaheadBoard({
  projectId,
  lookaheadId,
  activities,
  onBack,
}: {
  projectId: string
  lookaheadId: string
  activities: ScheduleActivity[]
  onBack: () => void
}) {
  const canUpdate = useCanPerform('lookahead', 'update')
  const canCreate = useCanPerform('lookahead', 'create')
  const canDelete = useCanPerform('lookahead', 'delete')
  const canExport = useCanPerform('lookahead', 'export')
  const canPublish = useCanPerform('lookahead', 'submit', 'lookahead.publish')
  const canArchive = useCanPerform('lookahead', 'update', 'lookahead.archive')
  const { data: lookahead, isLoading } = useLookahead(projectId, lookaheadId)
  const action = useLookaheadAction(projectId)
  const remove = useDeleteLookahead(projectId)
  const [openItem, setOpenItem] = useState<LookaheadItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | LookaheadItemStatus>(
    'all'
  )

  const items = useMemo(
    () =>
      (lookahead?.items ?? []).filter(
        (item) => statusFilter === 'all' || item.status === statusFilter
      ),
    [lookahead, statusFilter]
  )
  const days = useMemo(
    () => (lookahead?.grid ?? []).flatMap((week) => week.days),
    [lookahead]
  )

  const run = async (
    kind: 'refresh' | 'publish' | 'archive',
    message: (result: Awaited<ReturnType<typeof action.mutateAsync>>) => string
  ) => {
    try {
      const result = await action.mutateAsync({ id: lookaheadId, action: kind })
      toast.success(message(result))
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const rollForward = async (payload: {
    startDate: string
    weeks: number
    archiveSource: boolean
  }) => {
    try {
      const created = await action.mutateAsync({
        id: lookaheadId,
        action: 'roll-forward',
        body: payload,
      })
      setRolling(false)
      toast.success(`${created.ref} created`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const name = await downloadFile(
        `/projects/${projectId}/lookaheads/${lookaheadId}/export.xlsx`,
        'lookahead.xlsx'
      )
      toast.success(`Downloaded ${name}`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  const deletePlan = async () => {
    try {
      await remove.mutateAsync(lookaheadId)
      toast.success('Draft deleted')
      onBack()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  if (isLoading || !lookahead) {
    return (
      <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading the plan…
      </div>
    )
  }

  const editable = lookahead.status !== 'archived'
  const busy = action.isPending

  return (
    <div className='space-y-3' data-testid='uat-lookahead-board'>
      <div className='flex flex-wrap items-start gap-2'>
        <Button variant='ghost' size='sm' onClick={onBack}>
          <ArrowLeft className='mr-1 h-4 w-4' /> Plans
        </Button>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='font-mono text-xs text-muted-foreground'>
              {lookahead.ref}
            </p>
            <p className='font-medium'>{lookahead.title}</p>
            <Badge
              variant='outline'
              className={LOOKAHEAD_STATUS_CLASS[lookahead.status]}
            >
              {LOOKAHEAD_STATUS_LABEL[lookahead.status]}
            </Badge>
            {lookahead.current && (
              <Badge variant='outline' className='text-xs'>
                this week
              </Badge>
            )}
          </div>
          <p className='text-xs text-muted-foreground'>
            {fmtDate(lookahead.startDate)} → {fmtDate(lookahead.endDate)} ·{' '}
            {lookahead.weeks} weeks
            {lookahead.refreshedAt
              ? ` · schedule read ${new Date(lookahead.refreshedAt).toLocaleString()}`
              : ''}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          {canUpdate && editable && (
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() =>
                run(
                  'refresh',
                  (result) =>
                    `Schedule read: ${result.added ?? 0} added, ${result.updated ?? 0} updated, ${result.completed ?? 0} completed`
                )
              }
              data-testid='uat-lookahead-refresh'
            >
              <RefreshCw
                className={cn('mr-1 h-4 w-4', busy && 'animate-spin')}
              />
              Refresh from schedule
            </Button>
          )}
          {canUpdate && editable && (
            <Button
              size='sm'
              onClick={() => setAdding(true)}
              data-testid='uat-lookahead-add-task'
            >
              <Plus className='mr-1 h-4 w-4' /> Add task
            </Button>
          )}
          {canPublish && lookahead.status === 'draft' && (
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() =>
                run('publish', (result) => `${result.ref} published`)
              }
              data-testid='uat-lookahead-publish'
            >
              <Send className='mr-1 h-4 w-4' /> Publish
            </Button>
          )}
          {canCreate && editable && (
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => setRolling(true)}
              data-testid='uat-lookahead-roll-forward'
            >
              <ArrowRightToLine className='mr-1 h-4 w-4' /> Roll forward
            </Button>
          )}
          {canExport && (
            <Button
              variant='outline'
              size='sm'
              disabled={exporting}
              onClick={exportXlsx}
              data-testid='uat-lookahead-export'
            >
              <Download className='mr-1 h-4 w-4' />
              {exporting ? 'Exporting…' : 'XLSX'}
            </Button>
          )}
          {canArchive && editable && (
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() =>
                run('archive', (result) => `${result.ref} archived`)
              }
              data-testid='uat-lookahead-archive'
            >
              <Archive className='mr-1 h-4 w-4' /> Archive
            </Button>
          )}
          {canDelete && lookahead.status === 'draft' && (
            <Button
              variant={confirmDelete ? 'destructive' : 'ghost'}
              size='sm'
              disabled={remove.isPending}
              onClick={() =>
                confirmDelete ? deletePlan() : setConfirmDelete(true)
              }
              onBlur={() => setConfirmDelete(false)}
              data-testid='uat-lookahead-delete'
            >
              <Trash2 className='mr-1 h-4 w-4' />
              {confirmDelete ? 'Confirm delete' : 'Delete draft'}
            </Button>
          )}
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2 text-xs'>
        {(Object.keys(ITEM_STATUS_LABEL) as LookaheadItemStatus[]).map(
          (status) => (
            <button
              key={status}
              type='button'
              className={cn(
                'rounded-full border px-2 py-0.5',
                ITEM_STATUS_CLASS[status],
                statusFilter === status && 'ring-2 ring-primary/40'
              )}
              onClick={() =>
                setStatusFilter((current) =>
                  current === status ? 'all' : status
                )
              }
            >
              {ITEM_STATUS_LABEL[status]} · {lookahead.summary.byStatus[status]}
            </button>
          )
        )}
        {lookahead.summary.behind > 0 && (
          <span className='text-rose-600 dark:text-rose-300'>
            {lookahead.summary.behind} behind plan
          </span>
        )}
        {lookahead.summary.openConstraints > 0 && (
          <span className='inline-flex items-center gap-1 text-amber-700 dark:text-amber-300'>
            <AlertTriangle className='h-3.5 w-3.5' />
            {lookahead.summary.openConstraints} open constraint
            {lookahead.summary.openConstraints === 1 ? '' : 's'}
            {lookahead.summary.overdueConstraints > 0 &&
              ` (${lookahead.summary.overdueConstraints} overdue)`}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          {lookahead.summary.items === 0
            ? 'Nothing planned yet — refresh from the schedule or add a task.'
            : 'No task with this status.'}
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table
            className='w-full border-collapse text-sm'
            data-testid='uat-lookahead-grid'
          >
            <thead>
              <tr className='bg-muted/50 text-xs text-muted-foreground'>
                <th
                  rowSpan={2}
                  className='sticky left-0 z-10 min-w-56 bg-muted px-2 py-1 text-left font-medium'
                >
                  Task
                </th>
                <th rowSpan={2} className='px-2 py-1 text-left font-medium'>
                  Start
                </th>
                <th rowSpan={2} className='px-2 py-1 text-left font-medium'>
                  Finish
                </th>
                <th rowSpan={2} className='px-2 py-1 text-left font-medium'>
                  Status
                </th>
                {(lookahead.grid ?? []).map((week) => (
                  <th
                    key={week.index}
                    colSpan={7}
                    className={cn(
                      'border-l px-1 py-1 text-center font-medium whitespace-nowrap',
                      week.current && 'bg-sky-50 dark:bg-sky-950/30'
                    )}
                  >
                    {week.label}
                    {week.closed ? ' · closed' : ''}
                  </th>
                ))}
              </tr>
              <tr className='bg-muted/30 text-[10px] text-muted-foreground'>
                {days.map((day) => (
                  <th
                    key={day.date}
                    title={day.date}
                    className={cn(
                      'w-7 border-l px-0 py-0.5 text-center font-normal',
                      !day.working && 'bg-muted/60',
                      day.isToday &&
                        'bg-sky-100 font-bold text-sky-800 dark:bg-sky-900/40 dark:text-sky-100'
                    )}
                  >
                    {day.label.slice(0, 1)}
                    <br />
                    {Number(day.date.slice(8, 10))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className='cursor-pointer border-t hover:bg-muted/40'
                  onClick={() => setOpenItem(item)}
                >
                  <td className='sticky left-0 z-10 bg-background px-2 py-1'>
                    <div className='flex items-center gap-1.5'>
                      {item.constraintStatus === 'open' && (
                        <AlertTriangle
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            item.constraintOverdue
                              ? 'text-rose-600'
                              : 'text-amber-600'
                          )}
                        />
                      )}
                      {item.activity?.isCritical && (
                        <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-red-500' />
                      )}
                      <span className='truncate font-medium'>{item.name}</span>
                    </div>
                    <p className='truncate text-[11px] text-muted-foreground'>
                      {[
                        item.activity?.code,
                        item.wbsCode,
                        item.crew?.name,
                        item.location?.name,
                        item.source === 'carried' ? 'carried' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'added by hand'}
                    </p>
                  </td>
                  <td className='px-2 py-1 font-mono text-xs whitespace-nowrap'>
                    {fmtDate(item.plannedStart)}
                  </td>
                  <td className='px-2 py-1 font-mono text-xs whitespace-nowrap'>
                    {fmtDate(item.plannedFinish)}
                    {item.driftDays ? (
                      <span
                        title='Planned finish against the schedule'
                        className={cn(
                          'ml-1 rounded px-1 text-[10px]',
                          item.driftDays > 0
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700'
                        )}
                      >
                        {item.driftDays > 0
                          ? `+${item.driftDays}`
                          : item.driftDays}
                        d
                      </span>
                    ) : null}
                  </td>
                  <td className='px-2 py-1 whitespace-nowrap'>
                    <Badge
                      variant='outline'
                      className={ITEM_STATUS_CLASS[item.status]}
                    >
                      {ITEM_STATUS_LABEL[item.status]}
                      {item.status === 'in_progress'
                        ? ` ${Math.round(item.pctComplete)}%`
                        : ''}
                    </Badge>
                    {item.behind && (
                      <span className='ml-1 text-[10px] text-rose-600'>
                        behind
                      </span>
                    )}
                  </td>
                  {days.map((day) => {
                    const inside =
                      day.date >= item.plannedStart &&
                      day.date <= item.plannedFinish
                    return (
                      <td
                        key={day.date}
                        className={cn(
                          'border-l p-0',
                          !day.working && 'bg-muted/40',
                          day.isToday && 'border-x-2 border-x-sky-400'
                        )}
                      >
                        {inside && day.working && (
                          <div
                            className={cn(
                              'mx-px my-1 h-4 rounded-sm',
                              ITEM_BAR_CLASS[item.status]
                            )}
                            title={`${item.name} · ${day.date}`}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PpcCard lookahead={lookahead} />

      {lookahead.notes && (
        <p className='rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap'>
          {lookahead.notes}
        </p>
      )}

      <AuditHistoryPanel
        projectId={projectId}
        entityType='lookahead'
        entityId={lookaheadId}
        title='History'
      />

      <LookaheadItemDialog
        projectId={projectId}
        lookahead={lookahead}
        item={openItem}
        activities={activities}
        open={Boolean(openItem) || adding}
        onOpenChange={(value) => {
          if (!value) {
            setOpenItem(null)
            setAdding(false)
          }
        }}
      />
      <RollForwardDialog
        lookahead={lookahead}
        open={rolling}
        onOpenChange={setRolling}
        onSubmit={rollForward}
        pending={action.isPending}
      />
    </div>
  )
}
