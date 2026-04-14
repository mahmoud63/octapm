import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ScheduleActivity } from '../data/schema'

type EditablePatch = Partial<
  Pick<
    ScheduleActivity,
    'name' | 'duration' | 'predecessors' | 'earlyStart' | 'isMilestone'
  >
>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  activity: ScheduleActivity | null
  onSave: (patch: EditablePatch) => Promise<void>
  isSaving?: boolean
}

export function ActivityInlineEditDialog({
  open,
  onOpenChange,
  activity,
  onSave,
  isSaving = false,
}: Props) {
  const [name, setName] = useState(activity?.name ?? '')
  const [duration, setDuration] = useState(String(activity?.duration ?? 0))
  const [predecessors, setPredecessors] = useState(activity?.predecessors ?? '')
  const [earlyStart, setEarlyStart] = useState(
    String(activity?.earlyStart ?? 0)
  )
  const [isMilestone, setIsMilestone] = useState(Boolean(activity?.isMilestone))

  const handleSave = async () => {
    if (!activity) return

    const patch: EditablePatch = {
      name: name.trim(),
      duration: Math.max(0, Number(duration) || 0),
      predecessors: predecessors.trim(),
      earlyStart: Math.max(0, Number(earlyStart) || 0),
      isMilestone,
    }

    await onSave(patch)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Edit Activity</DialogTitle>
        </DialogHeader>

        <div className='grid gap-4 py-2'>
          <div className='grid gap-1.5'>
            <Label htmlFor='inline-name'>Activity Name</Label>
            <Input
              id='inline-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Activity name'
              disabled={isSaving}
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='inline-duration'>Duration (days)</Label>
              <Input
                id='inline-duration'
                type='number'
                min={0}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={isSaving}
              />
            </div>

            <div className='grid gap-1.5'>
              <Label htmlFor='inline-start'>Early Start (day)</Label>
              <Input
                id='inline-start'
                type='number'
                min={0}
                value={earlyStart}
                onChange={(e) => setEarlyStart(e.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='inline-preds'>Predecessors</Label>
            <Input
              id='inline-preds'
              value={predecessors}
              onChange={(e) => setPredecessors(e.target.value)}
              placeholder='Comma-separated WBS codes'
              disabled={isSaving}
            />
          </div>

          <div className='flex items-center gap-2'>
            <Checkbox
              id='inline-milestone'
              checked={isMilestone}
              onCheckedChange={(checked) => setIsMilestone(Boolean(checked))}
              disabled={isSaving}
            />
            <Label htmlFor='inline-milestone'>Mark as milestone</Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
