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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CompanyPicker, UserPicker } from '@/components/user-picker'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { useSheets } from '@/features/drawings/hooks/use-drawings'
import { LocationPicker } from '@/features/locations/components/location-picker'
import {
  FORM_TYPE_LABEL,
  useCreateFormInstance,
  useFormTemplates,
  type FormInstance,
  type FormRecurrence,
  type FormType,
} from '../hooks/use-forms'

const NONE = '__none'

/**
 * Schedules an inspection / ITP / form / talk from a template: who, where,
 * which activity, when, and whether it repeats.
 */
export function InstanceCreateDialog({
  projectId,
  open,
  onOpenChange,
  initialTemplateId = null,
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTemplateId?: string | null
  onCreated?: (instance: FormInstance) => void
}) {
  const { data: templates } = useFormTemplates(
    projectId,
    { scope: 'all' },
    { enabled: open }
  )
  const { data: activities } = useActivities(projectId)
  const { data: sheets } = useSheets(
    projectId,
    { status: 'current' },
    { enabled: open }
  )
  const create = useCreateFormInstance(projectId)
  const [templateId, setTemplateId] = useState<string>(initialTemplateId ?? '')
  const [title, setTitle] = useState('')
  const [activityId, setActivityId] = useState<string>('')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [sheetId, setSheetId] = useState<string>('')
  const [assigneeCompanyId, setAssigneeCompanyId] = useState<string | null>(
    null
  )
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null)
  const [inspectorUserId, setInspectorUserId] = useState<string | null>(null)
  const [approverUserId, setApproverUserId] = useState<string | null>(null)
  const [scheduledFor, setScheduledFor] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [every, setEvery] = useState<'' | FormRecurrence['every']>('')
  const [interval, setInterval] = useState('1')
  const [until, setUntil] = useState('')
  const [startNow, setStartNow] = useState(false)

  const active = (templates?.items ?? []).filter(
    (template) => template.status === 'active'
  )
  const selected = active.find((template) => template.id === templateId) ?? null
  const byType = (['itp', 'inspection', 'form', 'talk'] as FormType[]).map(
    (type) => ({
      type,
      items: active.filter((template) => template.type === type),
    })
  )

  const submit = async () => {
    try {
      const instance = await create.mutateAsync({
        templateId,
        title: title.trim() || null,
        activityId: activityId || null,
        locationId,
        sheetId: sheetId || null,
        assigneeCompanyId,
        assigneeUserId,
        inspectorUserId,
        approverUserId,
        scheduledFor: scheduledFor || null,
        dueDate: dueDate || null,
        recurrence: every
          ? {
              every,
              interval: Math.max(1, Number(interval) || 1),
              until: until || null,
            }
          : null,
        startNow,
      })
      toast.success(`${instance.ref} ${startNow ? 'started' : 'scheduled'}`)
      onCreated?.(instance)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-inspection-create'
      >
        <DialogHeader>
          <DialogTitle>Schedule an inspection</DialogTitle>
          <DialogDescription>
            Pick a template, say where and who. ITP hold points on the chosen
            activity block its progress approval until they pass.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger data-testid='uat-inspection-template'>
                <SelectValue placeholder='Choose a template' />
              </SelectTrigger>
              <SelectContent>
                {byType
                  .filter((group) => group.items.length)
                  .map((group) => (
                    <SelectGroup key={group.type}>
                      <SelectLabel>{FORM_TYPE_LABEL[group.type]}</SelectLabel>
                      {group.items.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                          {template.scope === 'company' ? ' · company' : ''}
                          {template.holdPointCount
                            ? ` · ${template.holdPointCount} hold`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
              </SelectContent>
            </Select>
            {active.length === 0 && (
              <p className='text-xs text-muted-foreground'>
                No active templates. Create one on the Templates tab or in the
                company library.
              </p>
            )}
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='ins-title'>Title</Label>
            <Input
              id='ins-title'
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                selected ? selected.name : 'Defaults to the template name'
              }
              maxLength={200}
              data-testid='uat-inspection-title'
            />
          </div>
          <div className='space-y-1'>
            <Label>Activity</Label>
            <Select
              value={activityId || NONE}
              onValueChange={(value) =>
                setActivityId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger data-testid='uat-inspection-activity'>
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
          {(sheets?.items.length ?? 0) > 0 && (
            <div className='space-y-1'>
              <Label>Drawing</Label>
              <Select
                value={sheetId || NONE}
                onValueChange={(value) =>
                  setSheetId(value === NONE ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='No drawing' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No drawing</SelectItem>
                  {(sheets?.items ?? []).map((sheet) => (
                    <SelectItem key={sheet.id} value={sheet.id}>
                      {sheet.number} · {sheet.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className='space-y-1'>
            <Label>Responsible company</Label>
            <CompanyPicker
              projectId={projectId}
              value={assigneeCompanyId}
              onChange={setAssigneeCompanyId}
              placeholder='Which subcontractor'
            />
          </div>
          <div className='space-y-1'>
            <Label>Assignee</Label>
            <UserPicker
              projectId={projectId}
              value={assigneeUserId}
              onChange={setAssigneeUserId}
              placeholder='Who fills it in'
              testId='uat-inspection-assignee'
            />
          </div>
          <div className='space-y-1'>
            <Label>Inspector</Label>
            <UserPicker
              projectId={projectId}
              value={inspectorUserId}
              onChange={setInspectorUserId}
              placeholder='Who inspects'
            />
          </div>
          <div className='space-y-1'>
            <Label>Approver</Label>
            <UserPicker
              projectId={projectId}
              value={approverUserId}
              onChange={setApproverUserId}
              placeholder='Who closes it'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='ins-scheduled'>Scheduled for</Label>
            <Input
              id='ins-scheduled'
              type='date'
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              data-testid='uat-inspection-scheduled'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='ins-due'>Due</Label>
            <Input
              id='ins-due'
              type='date'
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label>Repeats</Label>
            <div className='flex gap-2'>
              <Select
                value={every || NONE}
                onValueChange={(value) =>
                  setEvery(
                    value === NONE ? '' : (value as FormRecurrence['every'])
                  )
                }
              >
                <SelectTrigger data-testid='uat-inspection-recurrence'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Does not repeat</SelectItem>
                  <SelectItem value='day'>Every N days</SelectItem>
                  <SelectItem value='week'>Every N weeks</SelectItem>
                  <SelectItem value='month'>Every N months</SelectItem>
                </SelectContent>
              </Select>
              {every && (
                <Input
                  type='number'
                  min={1}
                  max={52}
                  value={interval}
                  onChange={(event) => setInterval(event.target.value)}
                  className='w-20'
                  aria-label='Interval'
                />
              )}
            </div>
          </div>
          {every && (
            <div className='space-y-1'>
              <Label htmlFor='ins-until'>Until</Label>
              <Input
                id='ins-until'
                type='date'
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter className='items-center gap-3 sm:justify-between'>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={startNow} onCheckedChange={setStartNow} />
            Start filling it in now
          </label>
          <div className='flex gap-2'>
            <Button variant='ghost' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!templateId || create.isPending}
              data-testid='uat-inspection-create-submit'
            >
              {create.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              {startNow ? 'Start' : 'Schedule'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
