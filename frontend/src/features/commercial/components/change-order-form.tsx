import { useState } from 'react'
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
    submittedDate?: string
    raisedBy?: string
  }) => Promise<void>
}

type FormState = {
  description: string
  category: string
  value: string
  scheduleImpact: string
  activityId: string
  submittedDate: string
  raisedBy: string
}

const defaultState: FormState = {
  description: '',
  category: '',
  value: '0',
  scheduleImpact: '0',
  activityId: '',
  submittedDate: '',
  raisedBy: '',
}

const toFormState = (initial?: ChangeOrderRecord | null): FormState => {
  if (!initial) return defaultState

  return {
    description: initial.description,
    category: initial.category || '',
    value: String(initial.value || 0),
    scheduleImpact: String(initial.scheduleImpact || 0),
    activityId: initial.activityId || '',
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
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

          <div className='grid gap-1.5'>
            <Label htmlFor='co-activity'>Affected Activity</Label>
            <select
              id='co-activity'
              className='h-9 rounded-md border bg-background px-2 text-sm'
              value={form.activityId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, activityId: e.target.value }))
              }
            >
              <option value=''>None</option>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.wbsCode ? `${activity.wbsCode} · ` : ''}
                  {activity.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || !form.description.trim()}
            onClick={async () => {
              await onSubmit({
                description: form.description.trim(),
                category: form.category || undefined,
                value: Number(form.value) || 0,
                scheduleImpact: Number(form.scheduleImpact) || 0,
                activityId: form.activityId || null,
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
