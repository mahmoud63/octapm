import { useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Copy,
  Download,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform, useProjectPartyAccess } from '@/lib/permissions'
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
import { Textarea } from '@/components/ui/textarea'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { CommentThread } from '@/features/comments/components/comment-thread'
import { useEquipment } from '@/features/equipment/hooks/use-equipment'
import { useLocations } from '@/features/locations/hooks/use-locations'
import { useProjectParties } from '@/features/projects/hooks/use-projects'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  DAILY_LOG_SECTIONS,
  downloadDailyLogPdf,
  shiftDate,
  todayKey,
  useCopyPreviousDay,
  useDailyLog,
  useDailyLogAction,
  useDailyLogSettings,
  useDailyLogs,
  useDistributeDailyLog,
  useRefreshDailyLogWeather,
  useUpdateDailyLog,
  type DailyLog,
  type DailyLogEntry,
} from '../hooks/use-daily-log'
import { DailyLogDraftAssistant } from './daily-log-ai-draft'
import { AiAction } from '@/features/ai/components/ai-action'
import {
  QUANTITIES_SECTION,
  QuantitiesSectionCard,
  SectionCard,
  type DailyLogQuantityEntry,
} from './daily-log-sections'
import { RaiseChangeEventButton } from '@/features/controls/exceptions/raise-change-event-button'
import { DailyLogSettingsDialog } from './daily-log-settings-dialog'
import { ManpowerReport } from './manpower-report'

const STATUS_LABEL: Record<DailyLog['status'], string> = {
  open: 'Open',
  submitted: 'Submitted',
  approved: 'Approved',
}
const statusVariant = (status: DailyLog['status']) =>
  status === 'approved'
    ? 'default'
    : status === 'submitted'
      ? 'secondary'
      : 'outline'
const fmt = (value: number, digits = 1) =>
  Math.round(value * 10 ** digits) / 10 ** digits

function WeatherCard({
  projectId,
  log,
  canUpdate,
  locked,
  hasCoordinates,
  feedOn,
}: {
  projectId: string
  log: DailyLog
  canUpdate: boolean
  locked: boolean
  hasCoordinates: boolean
  feedOn: boolean
}) {
  const refresh = useRefreshDailyLogWeather(projectId)
  const update = useUpdateDailyLog(projectId)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    condition: '',
    tempMinC: '',
    tempMaxC: '',
    precipitationMm: '',
    windMaxKph: '',
    notes: '',
  })
  const weather = log.weather
  const alerts = weather?.alerts ?? []
  const startEdit = () => {
    setForm({
      condition: weather?.condition ?? '',
      tempMinC:
        weather?.tempMinC === null || weather?.tempMinC === undefined
          ? ''
          : String(weather.tempMinC),
      tempMaxC:
        weather?.tempMaxC === null || weather?.tempMaxC === undefined
          ? ''
          : String(weather.tempMaxC),
      precipitationMm:
        weather?.precipitationMm === null ||
        weather?.precipitationMm === undefined
          ? ''
          : String(weather.precipitationMm),
      windMaxKph:
        weather?.windMaxKph === null || weather?.windMaxKph === undefined
          ? ''
          : String(weather.windMaxKph),
      notes: weather?.notes ?? '',
    })
    setEditing(true)
  }
  return (
    <section
      className='rounded-md border bg-card p-3'
      data-testid='uat-dailylog-weather'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <CloudSun className='h-4 w-4 text-muted-foreground' />
        <h4 className='text-sm font-semibold'>Weather</h4>
        {log.weatherSource === 'feed' && (
          <Badge variant='outline' className='text-[10px]'>
            from feed
            {log.weatherFetchedAt
              ? ` · ${new Date(log.weatherFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </Badge>
        )}
        {log.weatherSource === 'manual' && (
          <Badge variant='outline' className='text-[10px]'>
            entered by hand
          </Badge>
        )}
        <div className='ml-auto flex gap-1'>
          {canUpdate && !locked && feedOn && (
            <Button
              size='sm'
              variant='outline'
              className='h-7'
              disabled={refresh.isPending || !hasCoordinates}
              title={
                hasCoordinates
                  ? 'Fetch from the weather feed'
                  : 'Set the site coordinates in settings first'
              }
              data-testid='uat-dailylog-weather-refresh'
              onClick={async () => {
                try {
                  const result = await refresh.mutateAsync(log.date)
                  toast.success(
                    result.alerts?.length
                      ? `Weather updated — ${result.alerts.length} alert${result.alerts.length === 1 ? '' : 's'}, delay suggested`
                      : 'Weather updated from the feed'
                  )
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            >
              {refresh.isPending ? (
                <Loader2 className='mr-1 h-3 w-3 animate-spin' />
              ) : (
                <RefreshCw className='mr-1 h-3 w-3' />
              )}
              Fetch
            </Button>
          )}
          {canUpdate && !locked && (
            <Button
              size='sm'
              variant='ghost'
              className='h-7'
              onClick={() => (editing ? setEditing(false) : startEdit())}
            >
              <Pencil className='mr-1 h-3 w-3' /> {editing ? 'Close' : 'Edit'}
            </Button>
          )}
        </div>
      </div>
      {editing ? (
        <form
          className='mt-2 grid gap-2 sm:grid-cols-6'
          onSubmit={async (event) => {
            event.preventDefault()
            try {
              await update.mutateAsync({
                date: log.date,
                payload: {
                  weather: {
                    condition: form.condition || null,
                    tempMinC:
                      form.tempMinC === '' ? null : Number(form.tempMinC),
                    tempMaxC:
                      form.tempMaxC === '' ? null : Number(form.tempMaxC),
                    precipitationMm:
                      form.precipitationMm === ''
                        ? null
                        : Number(form.precipitationMm),
                    windMaxKph:
                      form.windMaxKph === '' ? null : Number(form.windMaxKph),
                    notes: form.notes || null,
                  },
                },
              })
              toast.success('Weather saved')
              setEditing(false)
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}
        >
          <Input
            aria-label='Condition'
            placeholder='Condition'
            value={form.condition}
            onChange={(e) => setForm({ ...form, condition: e.target.value })}
            className='h-8 text-xs sm:col-span-2'
          />
          <Input
            aria-label='Low °C'
            type='number'
            step='0.1'
            placeholder='Low °C'
            value={form.tempMinC}
            onChange={(e) => setForm({ ...form, tempMinC: e.target.value })}
            className='h-8 text-xs'
          />
          <Input
            aria-label='High °C'
            type='number'
            step='0.1'
            placeholder='High °C'
            value={form.tempMaxC}
            onChange={(e) => setForm({ ...form, tempMaxC: e.target.value })}
            className='h-8 text-xs'
          />
          <Input
            aria-label='Rain mm'
            type='number'
            step='0.1'
            min={0}
            placeholder='Rain mm'
            value={form.precipitationMm}
            onChange={(e) =>
              setForm({ ...form, precipitationMm: e.target.value })
            }
            className='h-8 text-xs'
          />
          <Input
            aria-label='Wind km/h'
            type='number'
            step='0.1'
            min={0}
            placeholder='Wind km/h'
            value={form.windMaxKph}
            onChange={(e) => setForm({ ...form, windMaxKph: e.target.value })}
            className='h-8 text-xs'
          />
          <Input
            aria-label='Weather notes'
            placeholder='Notes'
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className='h-8 text-xs sm:col-span-5'
          />
          <Button
            type='submit'
            size='sm'
            className='h-8'
            disabled={update.isPending}
          >
            Save
          </Button>
        </form>
      ) : weather ? (
        <div className='mt-2 space-y-1'>
          <p className='text-sm'>
            {weather.summary || weather.condition || '—'}
          </p>
          {weather.notes && (
            <p className='text-xs text-muted-foreground'>{weather.notes}</p>
          )}
          {alerts.map((alert) => (
            <p
              key={alert.metric}
              className='text-xs text-amber-700 dark:text-amber-300'
              data-testid='uat-dailylog-weather-alert'
            >
              ⚠ {alert.message}
            </p>
          ))}
        </div>
      ) : (
        <p className='mt-2 text-xs text-muted-foreground'>
          {hasCoordinates && feedOn
            ? 'Not fetched yet — the feed fills it in during the day, or press Fetch.'
            : 'No weather recorded. Set the site coordinates in settings for automatic weather, or enter it by hand.'}
        </p>
      )}
    </section>
  )
}

function DistributeDialog({
  projectId,
  log,
  defaults,
  open,
  onOpenChange,
}: {
  projectId: string
  log: DailyLog
  defaults: { roles: string[]; emails: string[] }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const distribute = useDistributeDailyLog(projectId)
  const [note, setNote] = useState('')
  const [extraEmails, setExtraEmails] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-dailylog-distribute'>
        <DialogHeader>
          <DialogTitle>Send daily log {log.date}</DialogTitle>
          <DialogDescription>
            Renders the PDF, files it on the day and sends it to the
            distribution list
            {defaults.roles.length ? ` (${defaults.roles.join(', ')})` : ''}
            {defaults.emails.length
              ? ` and ${defaults.emails.length} external address${defaults.emails.length === 1 ? '' : 'es'}`
              : ''}
            .
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          {log.totals.awaitingReview > 0 && (
            <p className='rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'>
              {log.totals.awaitingReview} collaborator entr
              {log.totals.awaitingReview === 1 ? 'y is' : 'ies are'} still
              awaiting review; they go out marked as such.
            </p>
          )}
          <div className='space-y-1'>
            <Label htmlFor='dl-note'>Message (optional)</Label>
            <Textarea
              id='dl-note'
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Anything the readers should know'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='dl-extra'>
              Also send to (emails, comma separated)
            </Label>
            <Input
              id='dl-extra'
              value={extraEmails}
              onChange={(e) => setExtraEmails(e.target.value)}
              placeholder='someone@example.com'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={distribute.isPending}
            data-testid='uat-dailylog-distribute-confirm'
            onClick={async () => {
              try {
                const extra = extraEmails
                  .split(/[\s,;]+/)
                  .map((value) => value.trim())
                  .filter(Boolean)
                const result = await distribute.mutateAsync({
                  date: log.date,
                  note: note || null,
                  ...(extra.length
                    ? { emails: [...defaults.emails, ...extra] }
                    : {}),
                })
                const sent = result.distribution?.emails.length ?? 0
                const failed = result.distribution?.failedEmails.length ?? 0
                toast.success(
                  `Sent · ${result.distribution?.notified ?? 0} notified · ${sent} emailed${failed ? ` · ${failed} failed` : ''}`
                )
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {distribute.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            <Send className='mr-1 h-4 w-4' /> Send now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The project daily log (OCTA-FLD-DAILY-022): one day at a time with typed
 * sections, feed-filled weather, copy-forward, per-entry review of
 * collaborator input, submit / approve, PDF and distribution.
 */
export function DailyLogPanel({
  projectId,
  activities,
  initialDate,
}: {
  projectId: string
  activities: ScheduleActivity[]
  initialDate?: string | null
}) {
  const [date, setDate] = useState(
    initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)
      ? initialDate
      : todayKey()
  )
  const [view, setView] = useState<'day' | 'report'>('day')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [distributeOpen, setDistributeOpen] = useState(false)
  const user = useAuthStore((state) => state.auth.user)
  const partyAccess = useProjectPartyAccess()
  const isParty = partyAccess.length > 0
  const canWrite = useCanPerform('progress', 'submit', 'daily_log.submit')
  const canUpdate = useCanPerform('progress', 'update', 'daily_log.update')
  const canReview = useCanPerform(
    'progress',
    'approve',
    'daily_log.entry_review'
  )
  const canApprove = useCanPerform('progress', 'approve', 'daily_log.approve')
  const canDistribute = useCanPerform(
    'progress',
    'submit',
    'daily_log.distribute'
  )
  const canConfigure = useCanPerform(
    'progress',
    'approve',
    'daily_log.configure'
  )
  const canExport = useCanPerform('progress', 'export')

  const { data: log, isLoading } = useDailyLog(projectId, date)
  const { data: settings } = useDailyLogSettings(projectId)
  const { data: recent } = useDailyLogs(projectId, {
    from: shiftDate(date, -13),
    to: date,
  })
  const { data: equipment = [] } = useEquipment(projectId)
  const { data: locations } = useLocations(projectId)
  const { data: parties } = useProjectParties(projectId)
  const copy = useCopyPreviousDay(projectId)
  const act = useDailyLogAction(projectId)
  const updateLog = useUpdateDailyLog(projectId)
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null)

  const context = useMemo(
    () => ({
      activities: activities.filter((activity) => !activity.isMilestone),
      locations: locations?.items ?? [],
      equipment,
      parties: parties?.items ?? [],
    }),
    [activities, locations, equipment, parties]
  )
  const ownsEntry = (entry: DailyLogEntry) =>
    !isParty ||
    (entry.partyId !== null &&
      partyAccess.some((party) => party.projectPartyId === entry.partyId)) ||
    (entry.createdBy !== null && entry.createdBy === user?.id)
  const locked = Boolean(
    log &&
    (log.status === 'approved' || (log.status === 'submitted' && isParty))
  )
  const recentByDate = new Map(
    (recent?.items ?? []).map((item) => [item.date, item])
  )
  // PC-6: the seventh section, sent by a server that has it; an older
  // server sends none and the card shows an empty section.
  const quantityEntries =
    ((log?.sections as Record<string, DailyLogEntry[] | undefined> | undefined)?.[
      QUANTITIES_SECTION
    ] as DailyLogQuantityEntry[] | undefined) ?? []

  const runAction = async (action: 'submit' | 'approve' | 'reopen') => {
    const reason =
      action === 'reopen'
        ? (window.prompt('Why reopen this day? (optional)') ?? '')
        : undefined
    try {
      await act.mutateAsync({ date, action, reason })
      toast.success(
        {
          submit: 'Day submitted for approval',
          approve: 'Day approved',
          reopen: 'Day reopened',
        }[action]
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='space-y-3' data-testid='uat-dailylog-panel'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='icon'
          variant='outline'
          className='h-8 w-8'
          aria-label='Previous day'
          onClick={() => setDate(shiftDate(date, -1))}
        >
          <ChevronLeft className='h-4 w-4' />
        </Button>
        <Input
          type='date'
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className='h-8 w-40'
          aria-label='Day'
          data-testid='uat-dailylog-date'
        />
        <Button
          size='icon'
          variant='outline'
          className='h-8 w-8'
          aria-label='Next day'
          disabled={date >= todayKey()}
          onClick={() => setDate(shiftDate(date, 1))}
        >
          <ChevronRight className='h-4 w-4' />
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='h-8'
          onClick={() => setDate(todayKey())}
        >
          <CalendarDays className='mr-1 h-4 w-4' /> Today
        </Button>
        {log && (
          <Badge
            variant={statusVariant(log.status)}
            data-testid='uat-dailylog-status'
          >
            {STATUS_LABEL[log.status]}
          </Badge>
        )}
        {log?.distributedAt && (
          <Badge variant='outline' className='text-[10px]'>
            sent{' '}
            {new Date(log.distributedAt).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Badge>
        )}
        <div className='ml-auto flex flex-wrap gap-1'>
          <Button
            size='sm'
            variant={view === 'report' ? 'default' : 'outline'}
            className='h-8'
            onClick={() => setView(view === 'report' ? 'day' : 'report')}
            data-testid='uat-dailylog-report-toggle'
          >
            <BarChart3 className='mr-1 h-4 w-4' /> Manpower report
          </Button>
          {canConfigure && settings && (
            <Button
              size='sm'
              variant='outline'
              className='h-8'
              onClick={() => setSettingsOpen(true)}
              data-testid='uat-dailylog-settings-open'
            >
              <Settings2 className='mr-1 h-4 w-4' /> Settings
            </Button>
          )}
        </div>
      </div>

      <div
        className='flex gap-1 overflow-x-auto pb-1'
        data-testid='uat-dailylog-strip'
      >
        {Array.from({ length: 14 }, (_, index) =>
          shiftDate(date, index - 13)
        ).map((key) => {
          const item = recentByDate.get(key)
          return (
            <button
              key={key}
              type='button'
              onClick={() => setDate(key)}
              className={`flex min-w-11 flex-col items-center rounded-md border px-1.5 py-1 text-[10px] ${key === date ? 'border-primary bg-primary/10' : 'hover:bg-muted'}`}
              title={
                item
                  ? `${item.totals.workers} workers · ${item.status}`
                  : 'No log'
              }
            >
              <span className='font-medium'>{key.slice(8)}</span>
              <span
                className={
                  item
                    ? item.status === 'approved'
                      ? 'text-emerald-600'
                      : item.status === 'submitted'
                        ? 'text-sky-600'
                        : 'text-foreground'
                    : 'text-muted-foreground'
                }
              >
                {item ? item.totals.workers : '·'}
              </span>
            </button>
          )
        })}
      </div>

      {view === 'report' ? (
        <ManpowerReport projectId={projectId} />
      ) : isLoading || !log ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          Loading day…
        </p>
      ) : (
        <>
          <div
            className='flex flex-wrap gap-2'
            data-testid='uat-dailylog-actions'
          >
            {canWrite && !locked && (
              <Button
                size='sm'
                variant='outline'
                disabled={copy.isPending}
                data-testid='uat-dailylog-copy'
                onClick={async () => {
                  try {
                    const result = await copy.mutateAsync({ date })
                    const copied = Object.entries(result.copy?.copied ?? {})
                      .map(([section, count]) => `${count} ${section}`)
                      .join(', ')
                    const skipped = Object.entries(result.copy?.skipped ?? {})
                      .map(([section, why]) => `${section}: ${why}`)
                      .join('; ')
                    toast.success(
                      `Copied from ${result.copy?.fromDate}${copied ? ` — ${copied}` : ''}${skipped ? ` (skipped ${skipped})` : ''}`
                    )
                  } catch (error) {
                    toast.error(getServerErrorMessage(error))
                  }
                }}
              >
                <Copy className='mr-1 h-4 w-4' /> Copy previous day
              </Button>
            )}
            {canWrite && !isParty && log.exists && log.status === 'open' && (
              <Button
                size='sm'
                onClick={() => runAction('submit')}
                disabled={act.isPending}
                data-testid='uat-dailylog-submit'
              >
                <Send className='mr-1 h-4 w-4' /> Submit day
              </Button>
            )}
            {canApprove && log.exists && log.status !== 'approved' && (
              <Button
                size='sm'
                onClick={() => runAction('approve')}
                disabled={act.isPending}
                data-testid='uat-dailylog-approve'
              >
                <CheckCircle2 className='mr-1 h-4 w-4' /> Approve day
              </Button>
            )}
            {canApprove && log.exists && log.status !== 'open' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => runAction('reopen')}
                disabled={act.isPending}
              >
                <RotateCcw className='mr-1 h-4 w-4' /> Reopen
              </Button>
            )}
            {canDistribute && log.exists && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setDistributeOpen(true)}
                data-testid='uat-dailylog-distribute-open'
              >
                <Send className='mr-1 h-4 w-4' /> Send PDF
              </Button>
            )}
            {canExport && log.exists && (
              <Button
                size='sm'
                variant='outline'
                className='ml-auto'
                onClick={() =>
                  downloadDailyLogPdf(projectId, date).catch((error) =>
                    toast.error(getServerErrorMessage(error))
                  )
                }
                data-testid='uat-dailylog-pdf'
              >
                <Download className='mr-1 h-4 w-4' /> PDF
              </Button>
            )}
            {/* PC-7b: a draft change event prefilled from this day's log (typed link). */}
            {log.exists && log.id && (
              <RaiseChangeEventButton
                projectId={projectId}
                source={{ type: 'daily_log', id: log.id }}
                testId='uat-dailylog-raise-change-event'
              />
            )}
          </div>
          {locked && (
            <p className='flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground'>
              <Lock className='h-3 w-3' />{' '}
              {log.status === 'approved'
                ? 'This day is approved and locked.'
                : 'This day has been submitted; ask the site team to reopen it before changing your entries.'}
            </p>
          )}

          <div
            className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7'
            data-testid='uat-dailylog-totals'
          >
            {[
              ['Workers', log.totals.workers],
              ['Man-hours', fmt(log.totals.manHours)],
              ['Companies', log.totals.companies],
              ['Plant', log.totals.equipmentCount],
              ['Deliveries', log.totals.deliveries],
              ['Visitors', log.totals.visitors],
              ['Hours lost', fmt(log.totals.hoursLost)],
            ].map(([label, value]) => (
              <div key={label as string} className='rounded-md border p-2'>
                <p className='text-[10px] tracking-wide text-muted-foreground uppercase'>
                  {label}
                </p>
                <p className='text-lg font-semibold tabular-nums'>{value}</p>
              </div>
            ))}
          </div>
          {(log.totals.awaitingReview > 0 || log.totals.suggestedDelays > 0) &&
            canReview && (
              <p className='text-xs text-amber-700 dark:text-amber-300'>
                {log.totals.awaitingReview > 0
                  ? `${log.totals.awaitingReview} collaborator entr${log.totals.awaitingReview === 1 ? 'y' : 'ies'} to review. `
                  : ''}
                {log.totals.suggestedDelays > 0
                  ? `${log.totals.suggestedDelays} weather delay suggestion to confirm.`
                  : ''}
              </p>
            )}

          <div className='grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'>
            <WeatherCard
              projectId={projectId}
              log={log}
              canUpdate={canUpdate}
              locked={locked}
              hasCoordinates={Boolean(settings?.hasCoordinates)}
              feedOn={Boolean(
                settings?.weatherFeedAvailable && settings?.weatherFeedEnabled
              )}
            />
            <section className='rounded-md border bg-card p-3'>
              <div className='flex items-center justify-between'>
                <h4 className='text-sm font-semibold'>Summary</h4>
                {canUpdate && !locked && summaryDraft === null && (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-7'
                    onClick={() => setSummaryDraft(log.summary ?? '')}
                  >
                    <Pencil className='mr-1 h-3 w-3' /> Edit
                  </Button>
                )}
              </div>
              {summaryDraft !== null ? (
                <div className='mt-2 space-y-2'>
                  <Textarea
                    rows={4}
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    placeholder='Progress in a few lines'
                  />
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      disabled={updateLog.isPending}
                      onClick={async () => {
                        try {
                          await updateLog.mutateAsync({
                            date,
                            payload: { summary: summaryDraft },
                          })
                          toast.success('Summary saved')
                          setSummaryDraft(null)
                        } catch (error) {
                          toast.error(getServerErrorMessage(error))
                        }
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setSummaryDraft(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className='mt-2 text-sm whitespace-pre-wrap text-muted-foreground'>
                  {log.summary || 'No summary yet.'}
                </p>
              )}
            </section>
          </div>

          {canUpdate && !locked && (
            <DailyLogDraftAssistant
              projectId={projectId}
              date={date}
              log={log}
            />
          )}
          {/* AI on this day's report, without leaving it (AI UX correction). */}
          {log.exists && log.id && (
            <div className='flex flex-wrap gap-2' data-testid='uat-dailylog-ai-actions'>
              <AiAction
                label='Summarize Today'
                record={{ recordType: 'daily_log', recordId: log.id, label: `Daily report ${log.date}` }}
                question={`Summarize the daily report for ${log.date}: work done, manpower, plant, deliveries, delays and issues. State the report's status as recorded.`}
              />
              <AiAction
                label='Check Missing Information'
                variant='ghost'
                record={{ recordType: 'daily_log', recordId: log.id, label: `Daily report ${log.date}` }}
                question={`Check the daily report for ${log.date} for missing or thin information a site manager would expect (sections left empty, delays without a cause, manpower without hours) and list what to complete.`}
              />
            </div>
          )}

          <div className='grid gap-3 xl:grid-cols-2'>
            {DAILY_LOG_SECTIONS.map((section) => (
              <SectionCard
                key={section}
                projectId={projectId}
                date={date}
                section={section}
                entries={log.sections[section]}
                context={context}
                canWrite={canWrite}
                canReview={canReview}
                canUpdate={canUpdate}
                locked={locked}
                ownsEntry={ownsEntry}
              />
            ))}
            <QuantitiesSectionCard
              projectId={projectId}
              date={date}
              entries={quantityEntries}
              context={context}
              canWrite={canWrite}
              canReview={canReview}
              locked={locked}
              ownsEntry={ownsEntry}
            />
          </div>

          {log.id && (
            <div className='grid gap-3 lg:grid-cols-3'>
              <AttachmentPanel
                projectId={projectId}
                recordType='daily_log'
                recordId={log.id}
                compact
              />
              <HistoryPanel
                projectId={projectId}
                entityType='daily_log'
                entityId={log.id}
                title='Day history'
                limit={20}
                showFilters={false}
              />
              <CommentThread
                projectId={projectId}
                recordType='daily_log'
                recordId={log.id}
                title='Discussion'
              />
            </div>
          )}
          {distributeOpen && settings && (
            <DistributeDialog
              projectId={projectId}
              log={log}
              defaults={{
                roles: settings.distributionRoles,
                emails: settings.distributionEmails,
              }}
              open={distributeOpen}
              onOpenChange={setDistributeOpen}
            />
          )}
        </>
      )}
      {settingsOpen && settings && (
        <DailyLogSettingsDialog
          key={settings.projectId + String(settingsOpen)}
          settings={settings}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </div>
  )
}
