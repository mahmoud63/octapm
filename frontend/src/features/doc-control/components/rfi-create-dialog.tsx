import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import { Textarea } from '@/components/ui/textarea'
import { UserPicker } from '@/components/user-picker'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { LocationPicker } from '@/features/locations/components/location-picker'
import { useCreateRfi, type RfiRecord } from '../hooks/use-doc-control'
import { RfiPeopleList } from './rfi-people-list'

const NONE = '__none'

/**
 * Full RFI form: question, references (activity, location, spec section),
 * manager / assignees / distribution, dates and impact flags. Saves as a
 * private draft or opens straight away.
 */
export function RfiCreateDialog({
  projectId,
  open,
  onOpenChange,
  partyItems = [],
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  partyItems?: Array<{ id: string; label: string }>
  onCreated?: (rfi: RfiRecord) => void
}) {
  const create = useCreateRfi(projectId)
  const { data: activities } = useActivities(projectId)
  const [subject, setSubject] = useState('')
  const [question, setQuestion] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [specSection, setSpecSection] = useState('')
  const [priority, setPriority] = useState<RfiRecord['priority']>('normal')
  const [activityId, setActivityId] = useState('')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [ownerPartyId, setOwnerPartyId] = useState('')
  const [managerUserId, setManagerUserId] = useState<string | null>(null)
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([])
  const [distributionUserIds, setDistributionUserIds] = useState<string[]>([])
  const [responseRequiredBy, setResponseRequiredBy] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [costImpact, setCostImpact] = useState(false)
  const [costImpactAmount, setCostImpactAmount] = useState('')
  const [scheduleImpactFlag, setScheduleImpactFlag] = useState(false)
  const [scheduleImpact, setScheduleImpact] = useState('')
  const [openNow, setOpenNow] = useState(true)

  const submit = async () => {
    try {
      const rfi = await create.mutateAsync({
        subject: subject.trim(),
        question: question.trim() || null,
        discipline: discipline.trim() || null,
        specSection: specSection.trim() || null,
        priority,
        activityId: activityId || null,
        locationId,
        ownerPartyId: ownerPartyId || undefined,
        managerUserId,
        assigneeUserIds,
        distributionUserIds,
        responseRequiredBy: responseRequiredBy || null,
        dueDate: dueDate || undefined,
        costImpact,
        costImpactAmount:
          costImpact && costImpactAmount.trim() !== ''
            ? Number(costImpactAmount)
            : null,
        scheduleImpactFlag,
        scheduleImpact: scheduleImpactFlag ? Number(scheduleImpact) || 0 : 0,
        status: openNow ? 'open' : 'draft',
      })
      toast.success(`${rfi.ref} ${openNow ? 'opened' : 'saved as draft'}`)
      onCreated?.(rfi)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'
        data-testid='uat-rfi-create'
      >
        <DialogHeader>
          <DialogTitle>New RFI</DialogTitle>
          <DialogDescription>
            Ask the question, point at the drawing, spec or activity it
            concerns, and say who answers. A draft stays private to you and the
            manager until it is opened.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='rfi-subject'>Subject</Label>
            <Input
              id='rfi-subject'
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder='e.g. Rebar spacing at gridline C, level 3 slab'
              maxLength={200}
              data-testid='uat-rfi-subject'
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='rfi-question'>Question</Label>
            <Textarea
              id='rfi-question'
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              placeholder='What is unclear, what you propose, and what you need decided'
              data-testid='uat-rfi-question'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='rfi-discipline'>Discipline</Label>
            <Input
              id='rfi-discipline'
              value={discipline}
              onChange={(event) => setDiscipline(event.target.value)}
              placeholder='Structural, MEP, Architectural…'
              maxLength={120}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='rfi-spec'>Spec section</Label>
            <Input
              id='rfi-spec'
              value={specSection}
              onChange={(event) => setSpecSection(event.target.value)}
              placeholder='e.g. 03 20 00'
              maxLength={120}
              data-testid='uat-rfi-spec'
            />
          </div>
          <div className='space-y-1'>
            <Label>Priority</Label>
            <Select
              value={priority}
              onValueChange={(value) =>
                setPriority(value as RfiRecord['priority'])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['low', 'normal', 'high', 'urgent'] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Activity</Label>
            <Select
              value={activityId || NONE}
              onValueChange={(value) =>
                setActivityId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger data-testid='uat-rfi-activity'>
                <SelectValue placeholder='No activity' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No activity</SelectItem>
                {(activities ?? []).slice(0, 500).map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Location</Label>
            <LocationPicker
              projectId={projectId}
              value={locationId}
              onChange={setLocationId}
              allowRoot
              rootLabel='No location'
              placeholder='Building / level / room'
            />
          </div>
          {partyItems.length > 0 && (
            <div className='space-y-1'>
              <Label>Owner party</Label>
              <Select
                value={ownerPartyId || NONE}
                onValueChange={(value) =>
                  setOwnerPartyId(value === NONE ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='Default' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Default</SelectItem>
                  {partyItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className='space-y-1'>
            <Label>Manager</Label>
            <UserPicker
              projectId={projectId}
              value={managerUserId}
              onChange={setManagerUserId}
              placeholder='Who reviews the answer and closes'
              testId='uat-rfi-manager'
            />
          </div>
          <RfiPeopleList
            projectId={projectId}
            label='Assignees (answer the question)'
            value={assigneeUserIds}
            onChange={setAssigneeUserIds}
            placeholder='Add an assignee'
            testId='uat-rfi-assignees'
          />
          <RfiPeopleList
            projectId={projectId}
            label='Distribution (kept informed)'
            value={distributionUserIds}
            onChange={setDistributionUserIds}
            placeholder='Add to distribution'
            testId='uat-rfi-distribution'
          />
          <div className='space-y-1'>
            <Label htmlFor='rfi-required'>Response required by</Label>
            <Input
              id='rfi-required'
              type='date'
              value={responseRequiredBy}
              onChange={(event) => setResponseRequiredBy(event.target.value)}
              data-testid='uat-rfi-required-by'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='rfi-due'>Due</Label>
            <Input
              id='rfi-due'
              type='date'
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <div className='space-y-2 rounded border p-3'>
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={costImpact}
                onCheckedChange={setCostImpact}
                data-testid='uat-rfi-cost-impact'
              />
              Cost impact expected
            </label>
            {costImpact && (
              <Input
                type='number'
                min={0}
                step='0.01'
                value={costImpactAmount}
                onChange={(event) => setCostImpactAmount(event.target.value)}
                placeholder='Estimated amount'
                aria-label='Cost impact amount'
              />
            )}
          </div>
          <div className='space-y-2 rounded border p-3'>
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={scheduleImpactFlag}
                onCheckedChange={setScheduleImpactFlag}
                data-testid='uat-rfi-schedule-impact'
              />
              Schedule impact expected
            </label>
            {scheduleImpactFlag && (
              <Input
                type='number'
                min={0}
                value={scheduleImpact}
                onChange={(event) => setScheduleImpact(event.target.value)}
                placeholder='Days'
                aria-label='Schedule impact days'
              />
            )}
          </div>
        </div>
        <DialogFooter className='items-center gap-3 sm:justify-between'>
          <label className='flex items-center gap-2 text-sm'>
            <Switch
              checked={openNow}
              onCheckedChange={setOpenNow}
              data-testid='uat-rfi-open-now'
            />
            Open now and notify assignees
          </label>
          <div className='flex gap-2'>
            <Button variant='ghost' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!subject.trim() || create.isPending}
              data-testid='uat-rfi-create-submit'
            >
              {create.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              {openNow ? 'Open RFI' : 'Save draft'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
