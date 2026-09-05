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
import { Textarea } from '@/components/ui/textarea'
import { UserPicker } from '@/components/user-picker'
import { useActivities } from '@/features/activities/hooks/use-activities'
import {
  useCreateSubmittal,
  useSubmittalPackages,
  useSubmittalWorkflowTemplates,
  type SubmittalRecord,
} from '../hooks/use-doc-control'
import { computeSubmitBy, formatDate } from '../lib/submittal-workflow'
import { RfiPeopleList } from './rfi-people-list'

const NONE = '__none'

/**
 * Full submittal form: what it is, where it goes on the programme, how long
 * it takes to arrive, who reviews it and who hears about the outcome. The
 * submit-by date is previewed as the fields change.
 */
export function SubmittalCreateDialog({
  projectId,
  open,
  onOpenChange,
  partyItems = [],
  defaultPackageId = null,
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  partyItems?: Array<{ id: string; label: string }>
  defaultPackageId?: string | null
  onCreated?: (submittal: SubmittalRecord) => void
}) {
  const create = useCreateSubmittal(projectId)
  const { data: activities } = useActivities(projectId)
  const { data: templates } = useSubmittalWorkflowTemplates(projectId)
  const { data: packages } = useSubmittalPackages(projectId)
  const defaultTemplate =
    templates?.items.find((template) => template.isDefault) ?? null
  const [title, setTitle] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [specRef, setSpecRef] = useState('')
  const [revision, setRevision] = useState('A')
  const [remarks, setRemarks] = useState('')
  const [activityId, setActivityId] = useState('')
  const [requiredOnSite, setRequiredOnSite] = useState('')
  const [leadTimeWeeks, setLeadTimeWeeks] = useState('')
  const [workflowTemplateId, setWorkflowTemplateId] = useState<string | null>(
    null
  )
  const [packageId, setPackageId] = useState(defaultPackageId ?? '')
  const [reviewerPartyId, setReviewerPartyId] = useState('')
  const [managerUserId, setManagerUserId] = useState<string | null>(null)
  const [distributionUserIds, setDistributionUserIds] = useState<string[]>([])

  const effectiveTemplateId = workflowTemplateId ?? defaultTemplate?.id ?? ''
  const template = templates?.items.find(
    (row) => row.id === effectiveTemplateId
  )
  const activity = activities?.find((row) => row.id === activityId)
  const submitBy = computeSubmitBy({
    requiredOnSite: requiredOnSite || null,
    activityStart: activity?.startDate ?? null,
    leadTimeWeeks: Number(leadTimeWeeks) || 0,
    reviewDays: template?.reviewDays ?? 0,
  })

  const submit = async () => {
    try {
      const submittal = await create.mutateAsync({
        title: title.trim(),
        discipline: discipline.trim() || null,
        specRef: specRef.trim() || null,
        revision: revision.trim() || 'A',
        remarks: remarks.trim() || null,
        activityId: activityId || null,
        requiredOnSite: requiredOnSite || null,
        leadTimeWeeks: leadTimeWeeks === '' ? null : Number(leadTimeWeeks),
        workflowTemplateId: effectiveTemplateId || null,
        packageId: packageId || null,
        reviewerPartyId: reviewerPartyId || null,
        managerUserId,
        distributionUserIds,
      })
      toast.success(`${submittal.ref} created`)
      onOpenChange(false)
      onCreated?.(submittal)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'
        data-testid='uat-sub-create'
      >
        <DialogHeader>
          <DialogTitle>New submittal</DialogTitle>
          <DialogDescription>
            Saved as not submitted. Attach the revision and submit it for review
            from the submittal page.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 md:grid-cols-2'>
          <div className='space-y-1 md:col-span-2'>
            <Label htmlFor='sub-title'>Title</Label>
            <Input
              id='sub-title'
              data-testid='uat-sub-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. Curtain wall shop drawings'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sub-discipline'>Discipline</Label>
            <Input
              id='sub-discipline'
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sub-spec'>Spec reference</Label>
            <Input
              id='sub-spec'
              value={specRef}
              onChange={(e) => setSpecRef(e.target.value)}
              placeholder='e.g. 08 44 13'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sub-revision'>Revision code</Label>
            <Input
              id='sub-revision'
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
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
              <SelectTrigger data-testid='uat-sub-activity'>
                <SelectValue placeholder='Link an activity' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No activity</SelectItem>
                {activities?.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sub-required'>Required on site</Label>
            <Input
              id='sub-required'
              type='date'
              data-testid='uat-sub-required-on-site'
              value={requiredOnSite}
              onChange={(e) => setRequiredOnSite(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              Leave empty to use the activity start
              {activity?.startDate
                ? ` (${formatDate(activity.startDate)})`
                : ''}
              .
            </p>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sub-lead'>Lead time (weeks)</Label>
            <Input
              id='sub-lead'
              type='number'
              min={0}
              max={104}
              data-testid='uat-sub-lead-time'
              value={leadTimeWeeks}
              onChange={(e) => setLeadTimeWeeks(e.target.value)}
              placeholder='After approval, until on site'
            />
          </div>
          <div className='space-y-1'>
            <Label>Review workflow</Label>
            <Select
              value={effectiveTemplateId || NONE}
              onValueChange={(value) =>
                setWorkflowTemplateId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger data-testid='uat-sub-workflow'>
                <SelectValue placeholder='No workflow' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  No workflow (manual review)
                </SelectItem>
                {templates?.items.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name} · {row.reviewDays} d
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Package</Label>
            <Select
              value={packageId || NONE}
              onValueChange={(value) =>
                setPackageId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger data-testid='uat-sub-package'>
                <SelectValue placeholder='No package' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No package</SelectItem>
                {packages?.items
                  .filter((row) => row.status !== 'closed')
                  .map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.ref} · {row.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {partyItems.length > 0 && (
            <div className='space-y-1'>
              <Label>Reviewing party</Label>
              <Select
                value={reviewerPartyId || NONE}
                onValueChange={(value) =>
                  setReviewerPartyId(value === NONE ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='No party' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No party</SelectItem>
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
            <Label>Submittal manager</Label>
            <UserPicker
              projectId={projectId}
              value={managerUserId}
              onChange={setManagerUserId}
              placeholder='Who shepherds it through'
              testId='uat-sub-manager'
              allowNone
            />
          </div>
          <div className='md:col-span-2'>
            <RfiPeopleList
              projectId={projectId}
              label='Distribution (told of the outcome)'
              value={distributionUserIds}
              onChange={setDistributionUserIds}
              testId='uat-sub-distribution'
            />
          </div>
          <div className='space-y-1 md:col-span-2'>
            <Label htmlFor='sub-remarks'>Notes</Label>
            <Textarea
              id='sub-remarks'
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>
        <div
          className='rounded-md border bg-muted/40 p-3 text-sm'
          data-testid='uat-sub-submit-by'
        >
          <span className='text-muted-foreground'>Submit by </span>
          <span className='font-medium'>
            {submitBy
              ? submitBy.toLocaleDateString()
              : '— set a need date or activity'}
          </span>
          {submitBy && (
            <span className='text-muted-foreground'>
              {' '}
              = need date − {Number(leadTimeWeeks) || 0} wk lead −{' '}
              {template?.reviewDays ?? 0} review days
            </span>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={create.isPending || !title.trim()}
            data-testid='uat-sub-create-submit'
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
