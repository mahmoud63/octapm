import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useDeleteReportSchedule,
  useReportSchedules,
  useSaveReportSchedule,
  type ReportSchedule,
} from '../hooks/use-report-builder'

const ROLES = [
  ['pm', 'Project managers'],
  ['planning_eng', 'Planning engineers'],
  ['qs', 'Quantity surveyors'],
  ['cost_controller', 'Cost controllers'],
  ['site_engineer', 'Site engineers'],
  ['quality_engineer', 'Quality engineers'],
  ['finance', 'Finance'],
  ['procurement', 'Procurement'],
  ['warehouse', 'Warehouse'],
] as const
const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const describe = (schedule: ReportSchedule) => {
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')} ${schedule.timezone}`
  if (schedule.frequency === 'daily') return `Every day at ${time}`
  if (schedule.frequency === 'weekly')
    return `Every ${DAYS[schedule.dayOfWeek]} at ${time}`
  return `Day ${schedule.dayOfMonth} of every month at ${time}`
}

function ScheduleForm({
  reportId,
  schedule,
  onDone,
}: {
  reportId: string
  schedule: ReportSchedule | null
  onDone: () => void
}) {
  const save = useSaveReportSchedule()
  const [frequency, setFrequency] = useState<ReportSchedule['frequency']>(
    schedule?.frequency ?? 'weekly'
  )
  const [dayOfWeek, setDayOfWeek] = useState(String(schedule?.dayOfWeek ?? 1))
  const [dayOfMonth, setDayOfMonth] = useState(
    String(schedule?.dayOfMonth ?? 1)
  )
  const [time, setTime] = useState(
    `${String(schedule?.hour ?? 7).padStart(2, '0')}:${String(schedule?.minute ?? 0).padStart(2, '0')}`
  )
  const [timezone, setTimezone] = useState(
    schedule?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'UTC'
  )
  const [format, setFormat] = useState<ReportSchedule['format']>(
    schedule?.format ?? 'pdf'
  )
  const [roles, setRoles] = useState<string[]>(
    schedule?.recipients.roles ?? ['pm']
  )
  const [emails, setEmails] = useState(
    (schedule?.recipients.emails ?? []).join('\n')
  )
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  return (
    <form
      className='space-y-3 rounded-md border p-3'
      data-testid='uat-report-schedule-form'
      onSubmit={async (event) => {
        event.preventDefault()
        const [hour, minute] = time.split(':').map(Number)
        try {
          await save.mutateAsync({
            reportId,
            scheduleId: schedule?.id ?? null,
            payload: {
              frequency,
              dayOfWeek: Number(dayOfWeek),
              dayOfMonth: Number(dayOfMonth),
              hour,
              minute,
              timezone,
              format,
              enabled,
              recipients: {
                userIds: schedule?.recipients.userIds ?? [],
                roles,
                emails: emails
                  .split(/[\s,;]+/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            },
          })
          toast.success(schedule ? 'Schedule updated' : 'Schedule created')
          onDone()
        } catch (error) {
          toast.error(getServerErrorMessage(error))
        }
      }}
    >
      <div className='grid gap-3 sm:grid-cols-4'>
        <div className='space-y-1'>
          <Label>Frequency</Label>
          <Select
            value={frequency}
            onValueChange={(value) =>
              setFrequency(value as ReportSchedule['frequency'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='daily'>Daily</SelectItem>
              <SelectItem value='weekly'>Weekly</SelectItem>
              <SelectItem value='monthly'>Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {frequency === 'weekly' && (
          <div className='space-y-1'>
            <Label>Day</Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {frequency === 'monthly' && (
          <div className='space-y-1'>
            <Label htmlFor='sched-dom'>Day of month</Label>
            <Input
              id='sched-dom'
              type='number'
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
            />
          </div>
        )}
        <div className='space-y-1'>
          <Label htmlFor='sched-time'>Time</Label>
          <Input
            id='sched-time'
            type='time'
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='sched-tz'>Time zone</Label>
          <Input
            id='sched-tz'
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder='Asia/Riyadh'
          />
        </div>
      </div>
      <div className='grid gap-3 sm:grid-cols-[160px_1fr]'>
        <div className='space-y-1'>
          <Label>Format</Label>
          <Select
            value={format}
            onValueChange={(value) =>
              setFormat(value as ReportSchedule['format'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='pdf'>PDF</SelectItem>
              <SelectItem value='xlsx'>XLSX</SelectItem>
              <SelectItem value='both'>PDF + XLSX</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Send to roles (in-app + email)</Label>
          <div className='grid grid-cols-2 gap-1 text-sm sm:grid-cols-4'>
            {ROLES.map(([value, label]) => (
              <label key={value} className='flex items-center gap-2'>
                <Checkbox
                  checked={roles.includes(value)}
                  onCheckedChange={() =>
                    setRoles(
                      roles.includes(value)
                        ? roles.filter((role) => role !== value)
                        : [...roles, value]
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className='space-y-1'>
        <Label htmlFor='sched-emails'>External addresses (one per line)</Label>
        <Textarea
          id='sched-emails'
          rows={2}
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder='director@example.com'
        />
      </div>
      <div className='flex items-center gap-2'>
        <Switch
          id='sched-enabled'
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        <Label htmlFor='sched-enabled'>Enabled</Label>
        <div className='ml-auto flex gap-2'>
          <Button type='button' variant='ghost' size='sm' onClick={onDone}>
            Cancel
          </Button>
          <Button
            type='submit'
            size='sm'
            disabled={save.isPending}
            data-testid='uat-report-schedule-save'
          >
            {save.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            {schedule ? 'Update' : 'Schedule'}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** Recurring delivery of a saved report. */
export function ReportSchedulesDialog({
  reportId,
  reportName,
  open,
  onOpenChange,
}: {
  reportId: string
  reportName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: schedules = [], isLoading } = useReportSchedules(
    open ? reportId : null
  )
  const remove = useDeleteReportSchedule()
  const [editing, setEditing] = useState<ReportSchedule | null | 'new'>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-report-schedules'
      >
        <DialogHeader>
          <DialogTitle>Schedules · {reportName}</DialogTitle>
          <DialogDescription>
            Each run renders the report as its owner — recipients only ever see
            what the owner could — and delivers it in-app and by email.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className='text-sm text-muted-foreground'>Loading…</p>
        ) : (
          <div className='space-y-2'>
            {schedules.map((schedule) =>
              editing !== 'new' && editing?.id === schedule.id ? (
                <ScheduleForm
                  key={schedule.id}
                  reportId={reportId}
                  schedule={schedule}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <div
                  key={schedule.id}
                  className='flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm'
                  data-testid='uat-report-schedule'
                >
                  <span className='font-medium'>{describe(schedule)}</span>
                  <Badge variant='outline'>
                    {schedule.format.toUpperCase()}
                  </Badge>
                  {!schedule.enabled && (
                    <Badge variant='secondary'>Paused</Badge>
                  )}
                  {schedule.lastStatus === 'failed' && (
                    <Badge
                      variant='destructive'
                      title={schedule.lastError ?? undefined}
                    >
                      Last run failed
                    </Badge>
                  )}
                  <span className='text-xs text-muted-foreground'>
                    {schedule.recipients.roles.length
                      ? `roles: ${schedule.recipients.roles.join(', ')}`
                      : ''}
                    {schedule.recipients.emails.length
                      ? ` · ${schedule.recipients.emails.length} email${schedule.recipients.emails.length === 1 ? '' : 's'}`
                      : ''}
                    {schedule.nextRunAt
                      ? ` · next ${new Date(schedule.nextRunAt).toLocaleString()}`
                      : ''}
                  </span>
                  <div className='ml-auto flex gap-1'>
                    <Button
                      size='sm'
                      variant='outline'
                      className='h-7'
                      onClick={() => setEditing(schedule)}
                    >
                      Edit
                    </Button>
                    <Button
                      size='icon'
                      variant='ghost'
                      className='h-7 w-7'
                      aria-label='Remove schedule'
                      disabled={remove.isPending}
                      onClick={async () => {
                        if (!window.confirm('Remove this schedule?')) return
                        try {
                          await remove.mutateAsync({
                            reportId,
                            scheduleId: schedule.id,
                          })
                          toast.success('Schedule removed')
                        } catch (error) {
                          toast.error(getServerErrorMessage(error))
                        }
                      }}
                    >
                      <Trash2 className='h-3 w-3' />
                    </Button>
                  </div>
                </div>
              )
            )}
            {editing === 'new' ? (
              <ScheduleForm
                reportId={reportId}
                schedule={null}
                onDone={() => setEditing(null)}
              />
            ) : (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setEditing('new')}
                data-testid='uat-report-schedule-new'
              >
                Add schedule
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
