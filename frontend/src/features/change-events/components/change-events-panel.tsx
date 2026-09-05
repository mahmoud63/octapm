import { useEffect, useState } from 'react'
import { GitBranchPlus, Loader2, Plus } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  CHANGE_EVENT_STATUS_LABEL,
  CHANGE_EVENT_TYPE_LABEL,
  useChangeEvents,
  useCreateChangeEvent,
  type ChangeEventStatus,
  type ChangeEventType,
} from '../hooks/use-change-events'
import { ChangeEventDialog, type ActivityOption } from './change-event-dialog'

const ALL = '__all__'
const NONE = '__none__'

export const CE_STATUS_CLASS: Record<ChangeEventStatus, string> = {
  open: 'border-slate-300 text-slate-700 dark:text-slate-200',
  pricing: 'border-blue-300 text-blue-700 dark:text-blue-200',
  priced: 'border-violet-300 text-violet-700 dark:text-violet-200',
  converted: 'border-emerald-300 text-emerald-700 dark:text-emerald-200',
  closed: 'border-zinc-300 text-zinc-600 dark:text-zinc-300',
  void: 'border-rose-300 text-rose-700 dark:text-rose-200',
}

const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 0 })

function NewChangeEventDialog({
  projectId,
  activities,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  activities: ActivityOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const create = useCreateChangeEvent(projectId)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ChangeEventType>('owner_change')
  const [description, setDescription] = useState('')
  const [activityId, setActivityId] = useState(NONE)
  const [rom, setRom] = useState('')
  const [days, setDays] = useState('0')
  useEffect(() => {
    if (!open) return
    setTitle('')
    setType('owner_change')
    setDescription('')
    setActivityId(NONE)
    setRom('')
    setDays('0')
  }, [open])
  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        title: title.trim(),
        type,
        description: description.trim() || null,
        activityId: activityId === NONE ? null : activityId,
        romAmount: rom.trim() === '' ? null : Number(rom),
        scheduleImpactDays: Number(days) || 0,
      })
      onOpenChange(false)
      onCreated(created.id)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-change-event-new'>
        <DialogHeader>
          <DialogTitle>New change event</DialogTitle>
          <DialogDescription>
            Capture a potential change before it is priced. Add scope lines,
            send RFQs and convert it into a change order from the event.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as ChangeEventType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(CHANGE_EVENT_TYPE_LABEL) as ChangeEventType[]
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {CHANGE_EVENT_TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label>Activity</Label>
              <Select value={activityId} onValueChange={setActivityId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— none —</SelectItem>
                  {activities.map((activity) => (
                    <SelectItem key={activity.id} value={activity.id}>
                      {activity.activityCode || activity.wbsCode
                        ? `${activity.activityCode || activity.wbsCode} · `
                        : ''}
                      {activity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label>Rough order of magnitude</Label>
              <Input
                type='number'
                min={0}
                value={rom}
                onChange={(event) => setRom(event.target.value)}
                placeholder='Optional until lines exist'
              />
            </div>
            <div className='space-y-1'>
              <Label>Schedule impact (days)</Label>
              <Input
                type='number'
                min={0}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || create.isPending}
            onClick={submit}
            data-testid='uat-change-event-create'
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

/** Commercial › Change Events: the register with totals, filters and the event workspace. */
export function ChangeEventsPanel({
  projectId,
  activities,
  initialRecordId,
}: {
  projectId: string
  activities: ActivityOption[]
  initialRecordId?: string
}) {
  const canCreate = useCanPerform('change_event', 'create')
  const [status, setStatus] = useState(ALL)
  const [type, setType] = useState(ALL)
  const [q, setQ] = useState('')
  const { data, isLoading } = useChangeEvents(projectId, {
    status: status === ALL ? undefined : status,
    type: type === ALL ? undefined : type,
    q,
  })
  const [openId, setOpenId] = useState<string | null>(initialRecordId ?? null)
  const [creating, setCreating] = useState(false)
  const summary = data?.summary

  return (
    <div className='space-y-3' data-testid='uat-change-events'>
      <div className='flex flex-wrap items-center gap-2'>
        <GitBranchPlus className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>Change events</p>
          <p className='text-xs text-muted-foreground'>
            Potential changes with their scope, rough order of magnitude and
            vendor quotes — converted into change orders once priced.
          </p>
        </div>
        {canCreate && (
          <Button
            size='sm'
            onClick={() => setCreating(true)}
            data-testid='uat-change-events-new'
          >
            <Plus className='mr-2 h-4 w-4' /> New change event
          </Button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
        {(
          [
            [
              'Live',
              summary
                ? String(
                    (summary.byStatus.open ?? 0) +
                      (summary.byStatus.pricing ?? 0) +
                      (summary.byStatus.priced ?? 0)
                  )
                : '—',
              'open · pricing · priced',
            ],
            [
              'ROM exposure',
              summary ? money(summary.romTotal) : '—',
              'live events',
            ],
            [
              'Quoted',
              summary ? money(summary.quotedTotal) : '—',
              'accepted quotes',
            ],
            [
              'Converted',
              summary ? money(summary.convertedValue) : '—',
              'change order value',
            ],
            [
              'Open RFQs',
              summary ? String(summary.openRfqs) : '—',
              'waiting on vendors',
            ],
            [
              'Quotes in',
              summary ? String(summary.quotesWaiting) : '—',
              'to accept or reject',
            ],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className='rounded border p-3'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <p className='text-2xl font-bold tabular-nums'>{value}</p>
            <p className='text-[11px] text-muted-foreground'>{hint}</p>
          </div>
        ))}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='w-56'
          placeholder='Search ref or title'
          value={q}
          onChange={(event) => setQ(event.target.value)}
          data-testid='uat-change-events-search'
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(
              Object.keys(CHANGE_EVENT_STATUS_LABEL) as ChangeEventStatus[]
            ).map((value) => (
              <SelectItem key={value} value={value}>
                {CHANGE_EVENT_STATUS_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className='w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {(Object.keys(CHANGE_EVENT_TYPE_LABEL) as ChangeEventType[]).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {CHANGE_EVENT_TYPE_LABEL[value]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading…
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          No change event yet. Raise one from an RFI, an observation or a site
          instruction — or here.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs text-muted-foreground'>
              <tr>
                <th className='px-2 py-1 text-left'>Ref</th>
                <th className='px-2 py-1 text-left'>Title</th>
                <th className='px-2 py-1 text-left'>Type</th>
                <th className='px-2 py-1 text-left'>Activity</th>
                <th className='px-2 py-1 text-right'>ROM</th>
                <th className='px-2 py-1 text-right'>Quoted</th>
                <th className='px-2 py-1 text-right'>RFQs</th>
                <th className='px-2 py-1 text-left'>Status</th>
                <th className='px-2 py-1 text-left'>Change order</th>
              </tr>
            </thead>
            <tbody data-testid='uat-change-events-rows'>
              {data!.items.map((event) => (
                <tr
                  key={event.id}
                  className='cursor-pointer border-t hover:bg-muted/40'
                  onClick={() => setOpenId(event.id)}
                >
                  <td className='px-2 py-1 font-mono text-xs'>{event.ref}</td>
                  <td className='px-2 py-1'>{event.title}</td>
                  <td className='px-2 py-1 text-xs'>
                    {CHANGE_EVENT_TYPE_LABEL[event.type]}
                  </td>
                  <td className='px-2 py-1 text-xs'>
                    {event.activity?.name ?? '—'}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {money(event.totals.rom)}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {event.totals.quoted === null
                      ? '·'
                      : money(event.totals.quoted)}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {event.rfqCounts.total
                      ? `${event.rfqCounts.quoted + event.rfqCounts.accepted}/${event.rfqCounts.total}`
                      : '·'}
                  </td>
                  <td className='px-2 py-1'>
                    <Badge
                      variant='outline'
                      className={cn(CE_STATUS_CLASS[event.status])}
                    >
                      {CHANGE_EVENT_STATUS_LABEL[event.status]}
                    </Badge>
                  </td>
                  <td className='px-2 py-1 font-mono text-xs'>
                    {event.changeOrder?.ref ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewChangeEventDialog
        projectId={projectId}
        activities={activities}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => setOpenId(id)}
      />
      <ChangeEventDialog
        projectId={projectId}
        activities={activities}
        changeEventId={openId}
        open={Boolean(openId)}
        onOpenChange={(value) => {
          if (!value) setOpenId(null)
        }}
      />
    </div>
  )
}
