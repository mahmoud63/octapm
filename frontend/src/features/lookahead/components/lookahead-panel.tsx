import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarRange, Loader2, Plus } from 'lucide-react'
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
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  LOOKAHEAD_STATUS_LABEL,
  WEEK_OPTIONS,
  useCreateLookahead,
  useLookaheadConstraints,
  useLookaheads,
  type Lookahead,
} from '../hooks/use-lookaheads'
import { LookaheadBoard } from './lookahead-board'
import {
  LOOKAHEAD_STATUS_CLASS,
  WEEK_START_OPTIONS,
  fmtDate,
  nextWeekStart,
  pct,
} from './lookahead-shared'

function NewLookaheadDialog({
  projectId,
  activities,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  activities: ScheduleActivity[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const create = useCreateLookahead(projectId)
  const [weekStartDay, setWeekStartDay] = useState(1)
  const [startDate, setStartDate] = useState(nextWeekStart(1))
  const [weeks, setWeeks] = useState(3)
  const [title, setTitle] = useState('')
  const [onlyCritical, setOnlyCritical] = useState(false)
  const [wbsPrefixes, setWbsPrefixes] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(activities.map((activity) => activity.category).filter(Boolean))
      ) as string[],
    [activities]
  )
  useEffect(() => {
    if (!open) return
    setWeekStartDay(1)
    setStartDate(nextWeekStart(1))
    setWeeks(3)
    setTitle('')
    setOnlyCritical(false)
    setWbsPrefixes('')
    setCategories([])
  }, [open])

  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        startDate,
        weeks,
        weekStartDay,
        title: title.trim() || null,
        filter: {
          onlyCritical,
          wbsPrefixes: wbsPrefixes
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          categories,
        },
      })
      onOpenChange(false)
      toast.success(
        `${created.ref} created with ${created.summary.items} task${created.summary.items === 1 ? '' : 's'} from the schedule`
      )
      onCreated(created.id)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-lookahead-new'>
        <DialogHeader>
          <DialogTitle>New lookahead</DialogTitle>
          <DialogDescription>
            A short-interval plan seeded with the activities due in the window.
            The start date moves back to the first day of its week.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>Week starts on</Label>
            <Select
              value={String(weekStartDay)}
              onValueChange={(value) => {
                const day = Number(value)
                setWeekStartDay(day)
                setStartDate(nextWeekStart(day))
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEK_START_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Start date</Label>
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
          <div className='space-y-1'>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder='Optional — defaults to the window'
              maxLength={200}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label>Only WBS starting with</Label>
            <Input
              value={wbsPrefixes}
              onChange={(event) => setWbsPrefixes(event.target.value)}
              placeholder='e.g. 1.2, 3 — comma separated, blank for all'
            />
          </div>
          {categoryOptions.length > 0 && (
            <div className='space-y-1 sm:col-span-2'>
              <Label>Phases</Label>
              <div className='flex flex-wrap gap-1.5'>
                {categoryOptions.map((category) => {
                  const active = categories.includes(category)
                  return (
                    <button
                      key={category}
                      type='button'
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-xs',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                      onClick={() =>
                        setCategories((current) =>
                          active
                            ? current.filter((value) => value !== category)
                            : [...current, category]
                        )
                      }
                    >
                      {category}
                    </button>
                  )
                })}
              </div>
              <p className='text-[11px] text-muted-foreground'>
                None selected = every phase.
              </p>
            </div>
          )}
          <div className='flex items-center justify-between rounded border px-3 py-2 sm:col-span-2'>
            <div>
              <p className='text-sm font-medium'>Critical activities only</p>
              <p className='text-xs text-muted-foreground'>
                Seed just the critical path.
              </p>
            </div>
            <Switch checked={onlyCritical} onCheckedChange={setOnlyCritical} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!startDate || create.isPending}
            onClick={submit}
            data-testid='uat-lookahead-create'
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

/** Schedule › Lookahead: the plans, the make-ready log, and the board of the open plan. */
export function LookaheadPanel({
  projectId,
  activities,
  initialLookaheadId,
}: {
  projectId: string
  activities: ScheduleActivity[]
  initialLookaheadId?: string | null
}) {
  const canCreate = useCanPerform('lookahead', 'create')
  const [openId, setOpenId] = useState<string | null>(
    initialLookaheadId ?? null
  )
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const { data, isLoading } = useLookaheads(projectId)
  const { data: constraints } = useLookaheadConstraints(projectId)
  useEffect(() => {
    if (initialLookaheadId) setOpenId(initialLookaheadId)
  }, [initialLookaheadId])

  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) => showArchived || item.status !== 'archived'
      ),
    [data, showArchived]
  )
  const current = useMemo(
    () =>
      data?.summary.currentId
        ? (data.items.find((item) => item.id === data.summary.currentId) ??
          null)
        : null,
    [data]
  )
  const latestPpc = useMemo(() => {
    const withPpc = (data?.items ?? []).filter(
      (item) => item.summary.ppc.ppc !== null
    )
    return withPpc[0]?.summary.ppc.ppc ?? null
  }, [data])

  if (openId) {
    return (
      <LookaheadBoard
        projectId={projectId}
        lookaheadId={openId}
        activities={activities}
        onBack={() => setOpenId(null)}
      />
    )
  }

  const openConstraints = constraints?.summary.open ?? 0
  const overdueConstraints = constraints?.summary.overdue ?? 0

  return (
    <div className='space-y-3' data-testid='uat-lookaheads'>
      <div className='flex flex-wrap items-center gap-2'>
        <CalendarRange className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>Lookahead planning</p>
          <p className='text-xs text-muted-foreground'>
            Two-to-six-week plans seeded from the schedule — commit the work,
            clear the constraints, measure what got done.
          </p>
        </div>
        {canCreate && (
          <Button
            size='sm'
            onClick={() => setCreating(true)}
            data-testid='uat-lookaheads-new'
          >
            <Plus className='mr-2 h-4 w-4' /> New lookahead
          </Button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        {(
          [
            ['Plans', String(data?.summary.count ?? '—'), 'all statuses'],
            [
              'This week',
              current ? current.ref : '—',
              current ? current.title : 'no plan covers today',
            ],
            [
              'Open constraints',
              String(openConstraints),
              'to clear before work starts',
            ],
            ['Overdue', String(overdueConstraints), 'constraints past due'],
            ['PPC', pct(latestPpc), 'latest plan with closed weeks'],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className='rounded border p-3'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <p className='truncate text-2xl font-bold tabular-nums'>{value}</p>
            <p className='truncate text-[11px] text-muted-foreground'>{hint}</p>
          </div>
        ))}
      </div>

      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <Switch
          id='lookahead-show-archived'
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        <Label htmlFor='lookahead-show-archived'>Show archived</Label>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          No lookahead yet. Create one to pull the next weeks' activities out of
          the schedule.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs text-muted-foreground'>
              <tr>
                <th className='px-2 py-1 text-left'>Ref</th>
                <th className='px-2 py-1 text-left'>Title</th>
                <th className='px-2 py-1 text-left'>Window</th>
                <th className='px-2 py-1 text-right'>Tasks</th>
                <th className='px-2 py-1 text-right'>Done</th>
                <th className='px-2 py-1 text-right'>Behind</th>
                <th className='px-2 py-1 text-right'>Constraints</th>
                <th className='px-2 py-1 text-right'>PPC</th>
                <th className='px-2 py-1 text-left'>Status</th>
              </tr>
            </thead>
            <tbody data-testid='uat-lookaheads-rows'>
              {items.map((lookahead: Lookahead) => (
                <tr
                  key={lookahead.id}
                  className={cn(
                    'cursor-pointer border-t hover:bg-muted/40',
                    lookahead.current && 'bg-sky-50/60 dark:bg-sky-950/20'
                  )}
                  onClick={() => setOpenId(lookahead.id)}
                >
                  <td className='px-2 py-1 font-mono text-xs'>
                    {lookahead.ref}
                  </td>
                  <td className='max-w-64 truncate px-2 py-1'>
                    {lookahead.title}
                  </td>
                  <td className='px-2 py-1 font-mono text-xs whitespace-nowrap'>
                    {fmtDate(lookahead.startDate)} →{' '}
                    {fmtDate(lookahead.endDate)} · {lookahead.weeks}w
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {lookahead.summary.items}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {lookahead.summary.byStatus.done}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1 text-right tabular-nums',
                      lookahead.summary.behind > 0 &&
                        'text-rose-600 dark:text-rose-300'
                    )}
                  >
                    {lookahead.summary.behind}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {lookahead.summary.openConstraints}
                    {lookahead.summary.overdueConstraints > 0 && (
                      <span className='ml-1 text-rose-600 dark:text-rose-300'>
                        ({lookahead.summary.overdueConstraints} late)
                      </span>
                    )}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {pct(lookahead.summary.ppc.ppc)}
                  </td>
                  <td className='px-2 py-1'>
                    <Badge
                      variant='outline'
                      className={LOOKAHEAD_STATUS_CLASS[lookahead.status]}
                    >
                      {LOOKAHEAD_STATUS_LABEL[lookahead.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(constraints?.items.length ?? 0) > 0 && (
        <div
          className='rounded-md border'
          data-testid='uat-lookahead-make-ready'
        >
          <div className='flex items-center gap-2 border-b px-3 py-2'>
            <AlertTriangle className='h-4 w-4 text-amber-600' />
            <p className='text-sm font-medium'>Make-ready log</p>
            <p className='text-xs text-muted-foreground'>
              Open constraints across the live plans, earliest due first.
            </p>
          </div>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs text-muted-foreground'>
              <tr>
                <th className='px-2 py-1 text-left'>Task</th>
                <th className='px-2 py-1 text-left'>Constraint</th>
                <th className='px-2 py-1 text-left'>Plan</th>
                <th className='px-2 py-1 text-left'>Due</th>
              </tr>
            </thead>
            <tbody>
              {constraints!.items.map((row) => (
                <tr
                  key={row.id}
                  className='cursor-pointer border-t hover:bg-muted/40'
                  onClick={() => row.lookahead && setOpenId(row.lookahead.id)}
                >
                  <td className='max-w-56 truncate px-2 py-1'>{row.name}</td>
                  <td className='max-w-72 truncate px-2 py-1'>
                    {row.constraint}
                  </td>
                  <td className='px-2 py-1 font-mono text-xs'>
                    {row.lookahead?.ref ?? '—'}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1 font-mono text-xs whitespace-nowrap',
                      row.constraintOverdue &&
                        'text-rose-600 dark:text-rose-300'
                    )}
                  >
                    {fmtDate(row.constraintDueDate)}
                    {row.constraintOverdue && ' · overdue'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewLookaheadDialog
        projectId={projectId}
        activities={activities}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => setOpenId(id)}
      />
    </div>
  )
}
