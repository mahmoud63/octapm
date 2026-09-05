import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  Plus,
  Users,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  downloadTimesheetsXlsx,
  shiftDate,
  useCreateTimesheet,
  useCrews,
  useTimesheetWeek,
  weekStartOf,
} from '../hooks/use-timesheets'
import { CrewsPanel } from './crews-panel'
import { ProductivityPanel } from './productivity-panel'
import {
  STATUS_CLASS,
  TimesheetEditorDialog,
  type ActivityOption,
} from './timesheet-editor'

const NO_CREW = '__none__'
const today = () => new Date().toISOString().slice(0, 10)
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
const number = (value: number, digits = 1) =>
  value.toLocaleString(undefined, { maximumFractionDigits: digits })

function NewTimesheetDialog({
  projectId,
  defaultDate,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  defaultDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (timesheetId: string) => void
}) {
  const { data: crews } = useCrews(projectId)
  const create = useCreateTimesheet(projectId)
  const [date, setDate] = useState(defaultDate)
  const [crewId, setCrewId] = useState(NO_CREW)
  const [hours, setHours] = useState('8')
  useEffect(() => {
    if (open) setDate(defaultDate)
  }, [open, defaultDate])
  const activeCrews = (crews?.items ?? []).filter(
    (crew) => crew.status === 'active'
  )
  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        date,
        crewId: crewId === NO_CREW ? null : crewId,
        defaultHours: Number(hours) || 8,
      })
      onOpenChange(false)
      onCreated(created.id)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md' data-testid='uat-timesheet-new'>
        <DialogHeader>
          <DialogTitle>New timesheet</DialogTitle>
          <DialogDescription>
            One timesheet per crew per day. With a crew, every member starts
            with the default hours on the crew&apos;s default activity and cost
            code; without one, add workers in the editor.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>Date</Label>
            <Input
              type='date'
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label>Crew</Label>
            <Select value={crewId} onValueChange={setCrewId}>
              <SelectTrigger data-testid='uat-timesheet-new-crew'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CREW}>
                  No crew — pick workers myself
                </SelectItem>
                {activeCrews.map((crew) => (
                  <SelectItem key={crew.id} value={crew.id}>
                    {crew.name} · {crew.memberCount} worker
                    {crew.memberCount === 1 ? '' : 's'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {crewId !== NO_CREW && (
            <div className='space-y-1'>
              <Label>Default hours per worker</Label>
              <Input
                type='number'
                min={0}
                max={24}
                step={0.5}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!date || create.isPending}
            onClick={submit}
            data-testid='uat-timesheet-new-submit'
          >
            {create.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Site Reporting › Timesheets: the week's grid (worker × day), the week's
 * timesheets with their status, crews and workers, and productivity by
 * activity.
 */
export function TimesheetsPanel({
  projectId,
  activities,
  initialTimesheetId = null,
}: {
  projectId: string
  activities: ActivityOption[]
  initialTimesheetId?: string | null
}) {
  const canCreate = useCanPerform('timesheet', 'create')
  const canExport = useCanPerform('timesheet', 'export')
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today()))
  const {
    data: week,
    isLoading,
    isFetching,
  } = useTimesheetWeek(projectId, weekStart)
  const [openId, setOpenId] = useState<string | null>(initialTimesheetId)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)

  const activityOptions = useMemo(
    () =>
      activities.map((activity) => ({
        id: activity.id,
        name: activity.name,
        wbsCode: activity.wbsCode ?? null,
        activityCode: activity.activityCode ?? null,
      })),
    [activities]
  )
  const weekEnd = shiftDate(weekStart, 6)
  const status = week?.totals.byStatus

  const exportWeek = async () => {
    setExporting(true)
    try {
      await downloadTimesheetsXlsx(projectId, { from: weekStart, to: weekEnd })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className='space-y-3' data-testid='uat-timesheets'>
      <div className='flex flex-wrap items-center gap-2'>
        <Clock className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>Timesheets</p>
          <p className='text-xs text-muted-foreground'>
            Hours per worker on schedule activities; approval posts the labour
            cost to the activity and the cost code.
          </p>
        </div>
        <div className='flex items-center gap-1'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setWeekStart(shiftDate(weekStart, -7))}
            title='Previous week'
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setWeekStart(weekStartOf(today()))}
          >
            {weekStart} → {weekEnd}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setWeekStart(shiftDate(weekStart, 7))}
            title='Next week'
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
          {isFetching && <Loader2 className='h-4 w-4 animate-spin' />}
        </div>
        {canExport && (
          <Button
            size='sm'
            variant='outline'
            disabled={exporting}
            onClick={exportWeek}
            data-testid='uat-timesheets-export'
          >
            {exporting ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Download className='mr-2 h-4 w-4' />
            )}
            XLSX
          </Button>
        )}
        {canCreate && (
          <Button
            size='sm'
            onClick={() => setCreating(true)}
            data-testid='uat-timesheets-new'
          >
            <Plus className='mr-2 h-4 w-4' /> New timesheet
          </Button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
        {(
          [
            ['Hours', week ? number(week.totals.hours) : '—', 'this week'],
            ['Overtime', week ? number(week.totals.overtime) : '—', 'hours'],
            [
              'Labour cost',
              week ? number(week.totals.cost, 2) : '—',
              'approved',
            ],
            ['Workers', week ? String(week.totals.workers) : '—', 'with hours'],
            [
              'Waiting',
              status ? String(status.submitted) : '—',
              'for approval',
            ],
            ['Returned', status ? String(status.rejected) : '—', 'to fix'],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className='rounded border p-3'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <p className='text-2xl font-bold tabular-nums'>{value}</p>
            <p className='text-[11px] text-muted-foreground'>{hint}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue='week' className='space-y-3'>
        <TabsList className='flex-wrap'>
          <TabsTrigger value='week'>Week grid</TabsTrigger>
          <TabsTrigger value='list'>Timesheets</TabsTrigger>
          <TabsTrigger value='crews'>
            <Users className='mr-1 h-3.5 w-3.5' /> Crews & workers
          </TabsTrigger>
          <TabsTrigger value='productivity'>Productivity</TabsTrigger>
        </TabsList>

        <TabsContent value='week'>
          {isLoading || !week ? (
            <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' /> Loading week…
            </div>
          ) : week.workers.length === 0 ? (
            <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
              No hours recorded this week. Create a timesheet for a crew and a
              day to start.
            </p>
          ) : (
            <div className='overflow-x-auto rounded-md border'>
              <table
                className='w-full text-sm'
                data-testid='uat-timesheets-week-grid'
              >
                <thead className='bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-2 py-1 text-left'>Worker</th>
                    {week.days.map((day) => (
                      <th key={day} className='px-2 py-1 text-right'>
                        {dayLabel(day)}
                      </th>
                    ))}
                    <th className='px-2 py-1 text-right'>Total</th>
                    <th className='px-2 py-1 text-right'>OT</th>
                    <th className='px-2 py-1 text-right'>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {week.workers.map((worker) => (
                    <tr key={worker.workerId} className='border-t'>
                      <td className='px-2 py-1'>
                        <div className='font-medium'>{worker.name}</div>
                        <div className='text-xs text-muted-foreground'>
                          {[worker.trade, worker.companyName]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </td>
                      {worker.days.map((day, index) => (
                        <td
                          key={week.days[index]}
                          className='px-2 py-1 text-right tabular-nums'
                        >
                          {day.hours ? (
                            <button
                              type='button'
                              className={cn(
                                'underline-offset-2 hover:underline',
                                day.overtime &&
                                  'text-amber-700 dark:text-amber-300'
                              )}
                              title={
                                day.overtime
                                  ? `${day.overtime} h overtime`
                                  : undefined
                              }
                              onClick={() =>
                                setOpenId(day.timesheetIds[0] ?? null)
                              }
                            >
                              {number(day.hours)}
                            </button>
                          ) : (
                            <span className='text-muted-foreground'>·</span>
                          )}
                        </td>
                      ))}
                      <td className='px-2 py-1 text-right font-medium tabular-nums'>
                        {number(worker.hours)}
                      </td>
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {worker.overtime ? number(worker.overtime) : '·'}
                      </td>
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {worker.cost ? number(worker.cost, 2) : '·'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className='bg-muted/30 font-medium'>
                  <tr>
                    <td className='px-2 py-1'>Total</td>
                    {week.totals.dayTotals.map((total, index) => (
                      <td
                        key={week.days[index]}
                        className='px-2 py-1 text-right tabular-nums'
                      >
                        {total ? number(total) : '·'}
                      </td>
                    ))}
                    <td className='px-2 py-1 text-right tabular-nums'>
                      {number(week.totals.hours)}
                    </td>
                    <td className='px-2 py-1 text-right tabular-nums'>
                      {number(week.totals.overtime)}
                    </td>
                    <td className='px-2 py-1 text-right tabular-nums'>
                      {number(week.totals.cost, 2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {week && week.activities.length > 0 && (
            <div className='mt-3 grid gap-3 md:grid-cols-2'>
              <div className='rounded-md border p-3 text-sm'>
                <p className='mb-1 text-xs font-medium text-muted-foreground'>
                  By activity
                </p>
                <ul className='space-y-0.5'>
                  {week.activities.slice(0, 10).map((row) => (
                    <li
                      key={row.activityId ?? 'none'}
                      className='flex justify-between gap-2'
                    >
                      <span className='truncate'>
                        {row.code ? `${row.code} · ` : ''}
                        {row.name}
                      </span>
                      <span className='tabular-nums'>
                        {number(row.hours)} h
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className='rounded-md border p-3 text-sm'>
                <p className='mb-1 text-xs font-medium text-muted-foreground'>
                  By crew
                </p>
                <ul className='space-y-0.5'>
                  {week.crews.map((row) => (
                    <li
                      key={row.crewId ?? 'none'}
                      className='flex justify-between gap-2'
                    >
                      <span className='truncate'>{row.name}</span>
                      <span className='tabular-nums'>
                        {number(row.hours)} h
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value='list'>
          {week && week.timesheets.length > 0 ? (
            <div className='overflow-x-auto rounded-md border'>
              <table
                className='w-full text-sm'
                data-testid='uat-timesheets-list'
              >
                <thead className='bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-2 py-1 text-left'>Date</th>
                    <th className='px-2 py-1 text-left'>Crew</th>
                    <th className='px-2 py-1 text-right'>Workers</th>
                    <th className='px-2 py-1 text-right'>Hours</th>
                    <th className='px-2 py-1 text-right'>OT</th>
                    <th className='px-2 py-1 text-right'>Cost</th>
                    <th className='px-2 py-1 text-left'>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {week.timesheets.map((sheet) => (
                    <tr
                      key={sheet.id}
                      className='cursor-pointer border-t hover:bg-muted/40'
                      onClick={() => setOpenId(sheet.id)}
                    >
                      <td className='px-2 py-1 font-mono text-xs'>
                        {sheet.date}
                      </td>
                      <td className='px-2 py-1'>{sheet.crew?.name ?? '—'}</td>
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {sheet.workerCount ?? sheet.entryCount ?? 0}
                      </td>
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {number(sheet.totalHours)}
                      </td>
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {sheet.overtimeHours
                          ? number(sheet.overtimeHours)
                          : '·'}
                      </td>
                      <td className='px-2 py-1 text-right tabular-nums'>
                        {sheet.totalCost ? number(sheet.totalCost, 2) : '·'}
                      </td>
                      <td className='px-2 py-1'>
                        <Badge
                          variant='outline'
                          className={STATUS_CLASS[sheet.status]}
                        >
                          {sheet.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
              No timesheets this week.
            </p>
          )}
        </TabsContent>

        <TabsContent value='crews'>
          <CrewsPanel projectId={projectId} activities={activityOptions} />
        </TabsContent>

        <TabsContent value='productivity'>
          <ProductivityPanel
            projectId={projectId}
            from={shiftDate(weekStart, -28)}
            to={weekEnd}
          />
        </TabsContent>
      </Tabs>

      <NewTimesheetDialog
        projectId={projectId}
        defaultDate={
          weekStart <= today() && today() <= weekEnd ? today() : weekStart
        }
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => setOpenId(id)}
      />
      <TimesheetEditorDialog
        projectId={projectId}
        timesheetId={openId}
        activities={activityOptions}
        open={Boolean(openId)}
        onOpenChange={(value) => {
          if (!value) setOpenId(null)
        }}
      />
    </div>
  )
}
