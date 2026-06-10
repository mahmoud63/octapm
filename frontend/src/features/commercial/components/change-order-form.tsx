import { useState } from 'react'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
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
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import type { ChangeOrderRecord } from '../hooks/use-commercial'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activities: ScheduleActivity[]
  initial?: ChangeOrderRecord | null
  isSaving?: boolean
  onSubmit: (payload: {
    description: string
    category?: string
    value?: number
    scheduleImpact?: number
    activityId?: string | null
    activityLinks?: Array<{
      activityId: string
      relationType: string
      scheduleImpactDays: number
      costImpact?: number
      impactBasis?: string | null
    }>
    supportingDocumentIds?: string[]
    submittedDate?: string
    raisedBy?: string
  }) => Promise<void>
}

type ActivityImpactState = {
  scheduleImpactDays: string
  costImpact: string
  impactBasis: string
}

type FormState = {
  description: string
  category: string
  value: string
  scheduleImpact: string
  activityIds: string[]
  activityImpacts: Record<string, ActivityImpactState>
  supportingDocumentIds: string
  submittedDate: string
  raisedBy: string
}

const defaultState: FormState = {
  description: '',
  category: '',
  value: '0',
  scheduleImpact: '0',
  activityIds: [],
  activityImpacts: {},
  supportingDocumentIds: '',
  submittedDate: '',
  raisedBy: '',
}

const toFormState = (initial?: ChangeOrderRecord | null): FormState => {
  if (!initial) return defaultState
  const activityLinks = initial.activityLinks || []
  const activityImpacts = Object.fromEntries(
    activityLinks.map((link) => [
      link.activityId,
      {
        scheduleImpactDays: String(
          link.scheduleImpactDays ?? initial.scheduleImpact ?? 0
        ),
        costImpact: String(link.costImpact ?? 0),
        impactBasis: link.impactBasis || '',
      },
    ])
  )

  return {
    description: initial.description,
    category: initial.category || '',
    value: String(initial.value || 0),
    scheduleImpact: String(initial.scheduleImpact || 0),
    activityIds: activityLinks.length
      ? activityLinks.map((link) => link.activityId).filter(Boolean)
      : initial.activityId
        ? [initial.activityId]
        : [],
    activityImpacts,
    supportingDocumentIds:
      initial.attachmentRefs
        ?.map((attachment) => attachment.documentId)
        .filter(Boolean)
        .join(', ') || '',
    submittedDate: initial.submittedDate
      ? new Date(initial.submittedDate).toISOString().slice(0, 10)
      : '',
    raisedBy: initial.raisedBy || '',
  }
}

export function ChangeOrderForm({
  open,
  onOpenChange,
  activities,
  initial,
  isSaving,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const selectedActivityIds = new Set(form.activityIds)
  const selectedActivities = form.activityIds
    .map((id) => activities.find((activity) => activity.id === id))
    .filter(Boolean) as ScheduleActivity[]

  const impactFor = (activityId: string): ActivityImpactState =>
    form.activityImpacts[activityId] || {
      scheduleImpactDays: form.scheduleImpact || '0',
      costImpact: '0',
      impactBasis: '',
    }

  const updateImpact = (
    activityId: string,
    patch: Partial<ActivityImpactState>
  ) => {
    setForm((prev) => ({
      ...prev,
      activityImpacts: {
        ...prev.activityImpacts,
        [activityId]: {
          ...(prev.activityImpacts[activityId] || {
            scheduleImpactDays: prev.scheduleImpact || '0',
            costImpact: '0',
            impactBasis: '',
          }),
          ...patch,
        },
      },
    }))
  }

  const documentIds = form.supportingDocumentIds
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {initial ? 'Edit Change Order' : 'Add Change Order'}
          </DialogTitle>
          <DialogDescription>
            Register variation/change orders with value and schedule impact.
          </DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-2 gap-3'>
          <div className='col-span-2 grid gap-1.5'>
            <Label htmlFor='co-description'>Description</Label>
            <Textarea
              id='co-description'
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-category'>Category</Label>
            <Input
              id='co-category'
              value={form.category}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, category: e.target.value }))
              }
              placeholder='Variation, Claims, etc.'
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-value'>Value</Label>
            <Input
              id='co-value'
              type='number'
              min={0}
              step={MONEY_INPUT_STEP}
              value={form.value}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, value: e.target.value }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-impact'>Schedule Impact (days)</Label>
            <Input
              id='co-impact'
              type='number'
              value={form.scheduleImpact}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, scheduleImpact: e.target.value }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-submitted-date'>Submitted Date</Label>
            <Input
              id='co-submitted-date'
              type='date'
              value={form.submittedDate}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, submittedDate: e.target.value }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-raised-by'>Raised By</Label>
            <Input
              id='co-raised-by'
              value={form.raisedBy}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, raisedBy: e.target.value }))
              }
            />
          </div>

          <div className='col-span-2 grid gap-1.5'>
            <Label>Affected Activities</Label>
            <div className='grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2'>
              {activities.map((activity) => (
                <label
                  key={activity.id}
                  className='flex items-start gap-2 rounded-sm px-2 py-1 text-xs hover:bg-muted/60'
                >
                  <input
                    type='checkbox'
                    className='mt-0.5'
                    checked={selectedActivityIds.has(activity.id)}
                    onChange={(e) => {
                      setForm((prev) => {
                        const next = new Set(prev.activityIds)
                        const activityImpacts = { ...prev.activityImpacts }
                        if (e.target.checked) next.add(activity.id)
                        else {
                          next.delete(activity.id)
                          delete activityImpacts[activity.id]
                        }
                        if (e.target.checked && !activityImpacts[activity.id]) {
                          activityImpacts[activity.id] = {
                            scheduleImpactDays: prev.scheduleImpact || '0',
                            costImpact: '0',
                            impactBasis: '',
                          }
                        }
                        return {
                          ...prev,
                          activityIds: Array.from(next),
                          activityImpacts,
                        }
                      })
                    }}
                  />
                  <span className='min-w-0'>
                    <span className='block truncate font-medium'>
                      {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                      {activity.name}
                    </span>
                    <span className='text-muted-foreground'>
                      {activity.isCritical ? 'Critical' : 'Float'}
                    </span>
                  </span>
                </label>
              ))}
              {activities.length === 0 && (
                <p className='p-2 text-xs text-muted-foreground'>
                  No schedule activities available.
                </p>
              )}
            </div>
          </div>

          {selectedActivities.length > 0 && (
            <div className='col-span-2 grid gap-2'>
              <Label>Activity Impact Analysis</Label>
              <div className='grid max-h-56 gap-2 overflow-y-auto rounded-md border p-2'>
                {selectedActivities.map((activity) => {
                  const impact = impactFor(activity.id)
                  return (
                    <div
                      key={activity.id}
                      className='grid gap-2 rounded-sm border bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_110px_130px]'
                    >
                      <div className='min-w-0'>
                        <p className='truncate text-xs font-medium'>
                          {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                          {activity.name}
                        </p>
                        <Input
                          className='mt-2 h-8 text-xs'
                          value={impact.impactBasis}
                          onChange={(e) =>
                            updateImpact(activity.id, {
                              impactBasis: e.target.value,
                            })
                          }
                          placeholder='Impact basis'
                        />
                      </div>
                      <div className='grid gap-1'>
                        <Label className='text-xs'>Days</Label>
                        <Input
                          className='h-8'
                          type='number'
                          value={impact.scheduleImpactDays}
                          onChange={(e) =>
                            updateImpact(activity.id, {
                              scheduleImpactDays: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className='grid gap-1'>
                        <Label className='text-xs'>Cost</Label>
                        <Input
                          className='h-8'
                          type='number'
                          min={0}
                          step={MONEY_INPUT_STEP}
                          value={impact.costImpact}
                          onChange={(e) =>
                            updateImpact(activity.id, {
                              costImpact: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className='col-span-2 grid gap-1.5'>
            <Label htmlFor='co-supporting-documents'>
              Supporting Document IDs
            </Label>
            <Input
              id='co-supporting-documents'
              value={form.supportingDocumentIds}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  supportingDocumentIds: e.target.value,
                }))
              }
              placeholder='Document IDs'
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || !form.description.trim()}
            onClick={async () => {
              if (!hasMoneyPrecision(form.value)) {
                toast.error(MONEY_PRECISION_MESSAGE)
                return
              }
              const invalidImpact = form.activityIds.some(
                (activityId) => !hasMoneyPrecision(impactFor(activityId).costImpact)
              )
              if (invalidImpact) {
                toast.error(MONEY_PRECISION_MESSAGE)
                return
              }

              await onSubmit({
                description: form.description.trim(),
                category: form.category || undefined,
                value: toMoneyNumber(form.value),
                scheduleImpact: Number(form.scheduleImpact) || 0,
                activityId: form.activityIds[0] || null,
                activityLinks: form.activityIds.map((activityId) => {
                  const impact = impactFor(activityId)
                  return {
                    activityId,
                    relationType: 'affected',
                    scheduleImpactDays:
                      Number(impact.scheduleImpactDays) || 0,
                    costImpact: toMoneyNumber(impact.costImpact),
                    impactBasis: impact.impactBasis || null,
                  }
                }),
                supportingDocumentIds: documentIds.length
                  ? documentIds
                  : undefined,
                submittedDate: form.submittedDate || undefined,
                raisedBy: form.raisedBy || undefined,
              })
            }}
          >
            {isSaving ? 'Saving...' : initial ? 'Save Changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
