import { useEffect, useMemo, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
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
import { useLocations } from '@/features/locations/hooks/use-locations'
import { useProjectTeam } from '@/features/permissions/hooks/use-permissions'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import { useCrews } from '@/features/timesheets/hooks/use-timesheets'
import {
  ITEM_STATUS_LABEL,
  VARIANCE_REASON_LABEL,
  useAddLookaheadItem,
  useRemoveLookaheadItem,
  useSetLookaheadItemStatus,
  useUpdateLookaheadItem,
  type Lookahead,
  type LookaheadConstraintStatus,
  type LookaheadItem,
  type LookaheadItemStatus,
  type LookaheadVarianceReason,
} from '../hooks/use-lookaheads'
import { ITEM_STATUS_CLASS, fmtDate } from './lookahead-shared'

const NONE = '__none__'

interface Props {
  projectId: string
  lookahead: Lookahead
  item: LookaheadItem | null
  activities: ScheduleActivity[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Add or edit one lookahead task: dates, crew, location, status, constraint. */
export function LookaheadItemDialog({
  projectId,
  lookahead,
  item,
  activities,
  open,
  onOpenChange,
}: Props) {
  const canUpdate = useCanPerform('lookahead', 'update')
  const canSetStatus = useCanPerform(
    'lookahead',
    'update',
    'lookahead.item_status'
  )
  const add = useAddLookaheadItem(projectId)
  const update = useUpdateLookaheadItem(projectId)
  const setStatus = useSetLookaheadItemStatus(projectId)
  const remove = useRemoveLookaheadItem(projectId)
  const { data: crews } = useCrews(projectId)
  const { data: locations } = useLocations(projectId, { enabled: open })
  const { data: team } = useProjectTeam(projectId, { enabled: open })

  const [name, setName] = useState('')
  const [activityId, setActivityId] = useState(NONE)
  const [plannedStart, setPlannedStart] = useState('')
  const [plannedFinish, setPlannedFinish] = useState('')
  const [crewId, setCrewId] = useState(NONE)
  const [locationId, setLocationId] = useState(NONE)
  const [assigneeUserId, setAssigneeUserId] = useState(NONE)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [status, setItemStatus] = useState<LookaheadItemStatus>('planned')
  const [pctComplete, setPctComplete] = useState('0')
  const [varianceReason, setVarianceReason] = useState<string>(NONE)
  const [constraint, setConstraint] = useState('')
  const [constraintStatus, setConstraintStatus] =
    useState<LookaheadConstraintStatus>('none')
  const [constraintOwnerUserId, setConstraintOwnerUserId] = useState(NONE)
  const [constraintDueDate, setConstraintDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!open) return
    setConfirmRemove(false)
    setName(item?.name ?? '')
    setActivityId(item?.activityId ?? NONE)
    setPlannedStart(item?.plannedStart ?? lookahead.startDate)
    setPlannedFinish(item?.plannedFinish ?? lookahead.startDate)
    setCrewId(item?.crewId ?? NONE)
    setLocationId(item?.locationId ?? NONE)
    setAssigneeUserId(item?.assigneeUserId ?? NONE)
    setQuantity(
      item?.quantity === null || item?.quantity === undefined
        ? ''
        : String(item.quantity)
    )
    setUnit(item?.unit ?? '')
    setItemStatus(item?.status ?? 'planned')
    setPctComplete(String(Math.round(item?.pctComplete ?? 0)))
    setVarianceReason(item?.varianceReason ?? NONE)
    setConstraint(item?.constraint ?? '')
    setConstraintStatus(item?.constraintStatus ?? 'none')
    setConstraintOwnerUserId(item?.constraintOwnerUserId ?? NONE)
    setConstraintDueDate(item?.constraintDueDate ?? '')
    setNotes(item?.notes ?? '')
  }, [open, item, lookahead.startDate])

  const activityOptions = useMemo(
    () =>
      activities
        .filter(
          (activity) =>
            activity.pctComplete < 100 || activity.id === item?.activityId
        )
        .map((activity) => ({
          id: activity.id,
          label:
            `${activity.activityCode || activity.p6ActivityId || ''} ${activity.name}`.trim(),
        })),
    [activities, item?.activityId]
  )
  const people = team?.items ?? []
  const editable = lookahead.status !== 'archived' && canUpdate
  const pending =
    add.isPending || update.isPending || setStatus.isPending || remove.isPending

  const payload = () => ({
    name: name.trim() || null,
    activityId: activityId === NONE ? null : activityId,
    plannedStart: plannedStart || null,
    plannedFinish: plannedFinish || plannedStart || null,
    crewId: crewId === NONE ? null : crewId,
    locationId: locationId === NONE ? null : locationId,
    assigneeUserId: assigneeUserId === NONE ? null : assigneeUserId,
    quantity: quantity.trim() === '' ? null : Number(quantity),
    unit: unit.trim() || null,
    status,
    pctComplete: Number(pctComplete) || 0,
    varianceReason:
      status === 'not_done' && varianceReason !== NONE
        ? (varianceReason as LookaheadVarianceReason)
        : null,
    constraint: constraint.trim() || null,
    constraintStatus: (constraint.trim()
      ? constraintStatus === 'none'
        ? 'open'
        : constraintStatus
      : 'none') as LookaheadConstraintStatus,
    constraintOwnerUserId:
      constraintOwnerUserId === NONE ? null : constraintOwnerUserId,
    constraintDueDate: constraintDueDate || null,
    notes: notes.trim() || null,
  })

  const save = async () => {
    try {
      if (item) {
        await update.mutateAsync({
          lookaheadId: lookahead.id,
          itemId: item.id,
          ...payload(),
        })
        toast.success('Task saved')
      } else {
        const created = await add.mutateAsync({
          lookaheadId: lookahead.id,
          ...payload(),
        })
        toast.success(`${created.name} added`)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const quickStatus = async (next: LookaheadItemStatus) => {
    if (!item) return
    if (next === 'not_done' && varianceReason === NONE) {
      setItemStatus('not_done')
      toast.message('Say why it was not done, then save')
      return
    }
    try {
      await setStatus.mutateAsync({
        lookaheadId: lookahead.id,
        itemId: item.id,
        status: next,
        varianceReason:
          next === 'not_done'
            ? (varianceReason as LookaheadVarianceReason)
            : null,
        pctComplete: next === 'done' ? 100 : next === 'planned' ? 0 : undefined,
      })
      toast.success(`${item.name}: ${ITEM_STATUS_LABEL[next].toLowerCase()}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const removeTask = async () => {
    if (!item) return
    try {
      await remove.mutateAsync({ lookaheadId: lookahead.id, itemId: item.id })
      toast.success('Task removed')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-lookahead-item'
      >
        <DialogHeader>
          <DialogTitle>{item ? item.name : 'Add task'}</DialogTitle>
          <DialogDescription>
            {item
              ? [
                  item.activity
                    ? `Activity ${item.activity.code ?? ''} ${item.activity.name}`
                    : 'Added by hand',
                  item.scheduleStart
                    ? `schedule ${fmtDate(item.scheduleStart)} → ${fmtDate(item.scheduleFinish)}`
                    : null,
                  item.driftDays
                    ? `${item.driftDays > 0 ? '+' : ''}${item.driftDays} days against the schedule`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `A task in ${lookahead.ref} — from an activity or on its own.`}
          </DialogDescription>
        </DialogHeader>

        {item && canSetStatus && lookahead.status !== 'archived' && (
          <div
            className='flex flex-wrap items-center gap-1.5'
            data-testid='uat-lookahead-item-quick-status'
          >
            {(Object.keys(ITEM_STATUS_LABEL) as LookaheadItemStatus[]).map(
              (value) => (
                <button
                  key={value}
                  type='button'
                  disabled={pending}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs',
                    ITEM_STATUS_CLASS[value],
                    item.status === value && 'ring-2 ring-primary/40'
                  )}
                  onClick={() => quickStatus(value)}
                >
                  {ITEM_STATUS_LABEL[value]}
                </button>
              )
            )}
          </div>
        )}

        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label>Task</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={300}
              disabled={!editable}
              placeholder='Defaults to the activity name'
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label>Activity</Label>
            <Select
              value={activityId}
              onValueChange={setActivityId}
              disabled={
                !editable ||
                Boolean(item?.activityId && item.source === 'schedule')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {activityOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Planned start</Label>
            <Input
              type='date'
              value={plannedStart}
              onChange={(event) => setPlannedStart(event.target.value)}
              disabled={!editable}
            />
          </div>
          <div className='space-y-1'>
            <Label>Planned finish</Label>
            <Input
              type='date'
              value={plannedFinish}
              onChange={(event) => setPlannedFinish(event.target.value)}
              disabled={!editable}
            />
          </div>
          <div className='space-y-1'>
            <Label>Crew</Label>
            <Select
              value={crewId}
              onValueChange={setCrewId}
              disabled={!editable}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {(crews?.items ?? []).map((crew) => (
                  <SelectItem key={crew.id} value={crew.id}>
                    {crew.name}
                    {crew.companyName ? ` · ${crew.companyName}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Location</Label>
            <Select
              value={locationId}
              onValueChange={setLocationId}
              disabled={!editable}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {(locations?.items ?? []).map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.fullName || location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Responsible</Label>
            <Select
              value={assigneeUserId}
              onValueChange={setAssigneeUserId}
              disabled={!editable}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {people.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div className='space-y-1'>
              <Label>Quantity</Label>
              <Input
                type='number'
                min={0}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                disabled={!editable}
              />
            </div>
            <div className='space-y-1'>
              <Label>Unit</Label>
              <Input
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                maxLength={20}
                disabled={!editable}
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                setItemStatus(value as LookaheadItemStatus)
              }
              disabled={!editable}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ITEM_STATUS_LABEL) as LookaheadItemStatus[]).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {ITEM_STATUS_LABEL[value]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          {status === 'not_done' ? (
            <div className='space-y-1'>
              <Label>Why not done</Label>
              <Select
                value={varianceReason}
                onValueChange={setVarianceReason}
                disabled={!editable}
              >
                <SelectTrigger data-testid='uat-lookahead-item-reason'>
                  <SelectValue placeholder='Choose a reason' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— choose —</SelectItem>
                  {(
                    Object.keys(
                      VARIANCE_REASON_LABEL
                    ) as LookaheadVarianceReason[]
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {VARIANCE_REASON_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className='space-y-1'>
              <Label>% complete</Label>
              <Input
                type='number'
                min={0}
                max={100}
                value={pctComplete}
                onChange={(event) => setPctComplete(event.target.value)}
                disabled={!editable}
              />
            </div>
          )}
          <div className='space-y-1 sm:col-span-2'>
            <Label>Constraint to clear</Label>
            <Textarea
              value={constraint}
              onChange={(event) => setConstraint(event.target.value)}
              rows={2}
              maxLength={1000}
              disabled={!editable}
              placeholder='What must be in place before this can start — information, material, access, permit…'
              data-testid='uat-lookahead-item-constraint'
            />
          </div>
          {constraint.trim() && (
            <>
              <div className='space-y-1'>
                <Label>Constraint status</Label>
                <Select
                  value={
                    constraintStatus === 'none' ? 'open' : constraintStatus
                  }
                  onValueChange={(value) =>
                    setConstraintStatus(value as LookaheadConstraintStatus)
                  }
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='open'>Open</SelectItem>
                    <SelectItem value='cleared'>Cleared</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label>Owner</Label>
                <Select
                  value={constraintOwnerUserId}
                  onValueChange={setConstraintOwnerUserId}
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— none —</SelectItem>
                    {people.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label>Needed by</Label>
                <Input
                  type='date'
                  value={constraintDueDate}
                  onChange={(event) => setConstraintDueDate(event.target.value)}
                  disabled={!editable}
                />
              </div>
            </>
          )}
          <div className='space-y-1 sm:col-span-2'>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={4000}
              disabled={!editable}
            />
          </div>
        </div>

        <DialogFooter className='gap-2 sm:justify-between'>
          <div>
            {item && editable && (
              <Button
                type='button'
                variant={confirmRemove ? 'destructive' : 'ghost'}
                size='sm'
                disabled={pending}
                onClick={() =>
                  confirmRemove ? removeTask() : setConfirmRemove(true)
                }
                data-testid='uat-lookahead-item-remove'
              >
                <Trash2 className='mr-1 h-4 w-4' />
                {confirmRemove ? 'Confirm remove' : 'Remove'}
              </Button>
            )}
          </div>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {editable && (
              <Button
                disabled={pending || (!name.trim() && activityId === NONE)}
                onClick={save}
                data-testid='uat-lookahead-item-save'
              >
                {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                {item ? 'Save' : 'Add task'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
