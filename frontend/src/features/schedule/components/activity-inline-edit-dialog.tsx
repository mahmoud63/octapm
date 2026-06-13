import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
import type {
  DependencyRelationship,
  ScheduleActivity,
} from '../data/schema'

type EditablePatch = Partial<
  Pick<
    ScheduleActivity,
    | 'name'
    | 'duration'
    | 'dependencies'
    | 'earlyStart'
    | 'isMilestone'
  >
>

type EditableDependency = {
  predecessorId: string
  relationshipType: DependencyRelationship
  lagDays: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  activity: ScheduleActivity | null
  activities: ScheduleActivity[]
  onSave: (patch: EditablePatch) => Promise<void>
  isSaving?: boolean
}

const RELATIONSHIP_OPTIONS: DependencyRelationship[] = ['FS', 'SS', 'FF', 'SF']

function activityLabel(activity: ScheduleActivity) {
  const ref =
    activity.activityCode || activity.p6ActivityId || activity.id.slice(0, 8)
  return `${ref} - ${activity.name}`
}

const formatLag = (lagDays: number) => {
  if (!lagDays) return '0'
  return lagDays > 0 ? `+${lagDays}` : String(lagDays)
}

export function ActivityInlineEditDialog({
  open,
  onOpenChange,
  activity,
  activities,
  onSave,
  isSaving = false,
}: Props) {
  const [name, setName] = useState(activity?.name ?? '')
  const [duration, setDuration] = useState(String(activity?.duration ?? 0))
  const [dependencies, setDependencies] = useState<EditableDependency[]>(
    () =>
      (activity?.dependencies ?? []).map((dependency) => ({
        predecessorId: dependency.predecessorId,
        relationshipType: dependency.relationshipType,
        lagDays: dependency.lagDays,
      }))
  )
  const [earlyStart, setEarlyStart] = useState(
    String(activity?.earlyStart ?? 0)
  )
  const [isMilestone, setIsMilestone] = useState(Boolean(activity?.isMilestone))

  const predecessorOptions = useMemo(
    () => activities.filter((item) => item.id !== activity?.id),
    [activities, activity?.id]
  )

  const successorRows = useMemo(() => {
    if (!activity) return []
    return activities.flatMap((item) =>
      (item.dependencies ?? [])
        .filter((dependency) => dependency.predecessorId === activity.id)
        .map((dependency) => ({
          successor: item,
          relationshipType: dependency.relationshipType,
          lagDays: dependency.lagDays,
        }))
    )
  }, [activities, activity])

  const duplicatePredecessors = useMemo(() => {
    const seen = new Set<string>()
    for (const dependency of dependencies) {
      if (!dependency.predecessorId) continue
      if (seen.has(dependency.predecessorId)) return true
      seen.add(dependency.predecessorId)
    }
    return false
  }, [dependencies])

  const dependencyError =
    dependencies.some((dependency) => !dependency.predecessorId) ||
    duplicatePredecessors

  const addDependency = () => {
    const next = predecessorOptions.find(
      (option) =>
        !dependencies.some(
          (dependency) => dependency.predecessorId === option.id
        )
    )
    if (!next) return
    setDependencies((current) => [
      ...current,
      { predecessorId: next.id, relationshipType: 'FS', lagDays: 0 },
    ])
  }

  const updateDependency = (
    index: number,
    patch: Partial<EditableDependency>
  ) => {
    setDependencies((current) =>
      current.map((dependency, itemIndex) =>
        itemIndex === index ? { ...dependency, ...patch } : dependency
      )
    )
  }

  const removeDependency = (index: number) => {
    setDependencies((current) =>
      current.filter((_dependency, itemIndex) => itemIndex !== index)
    )
  }

  const handleSave = async () => {
    if (!activity) return

    const patch: EditablePatch = {
      name: name.trim(),
      duration: Math.max(0, Number(duration) || 0),
      dependencies: dependencies.map((dependency) => ({
        id: `${activity.id}:${dependency.predecessorId}`,
        projectId: activity.projectId,
        predecessorId: dependency.predecessorId,
        successorId: activity.id,
        relationshipType: dependency.relationshipType,
        lagDays: Math.round(Number(dependency.lagDays) || 0),
      })),
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

          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-3'>
              <Label>Relationship Grid</Label>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={addDependency}
                disabled={
                  isSaving ||
                  predecessorOptions.length === 0 ||
                  dependencies.length >= predecessorOptions.length
                }
              >
                <Plus className='h-4 w-4' />
                Add
              </Button>
            </div>

            <div className='grid gap-2'>
              <p className='text-xs font-medium text-muted-foreground'>
                Predecessors
              </p>
              {dependencies.map((dependency, index) => (
                <div
                  key={`${dependency.predecessorId}-${index}`}
                  className='grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-[1fr_78px_92px_32px]'
                >
                  <select
                    className='h-9 min-w-0 rounded-md border bg-background px-2 text-sm'
                    value={dependency.predecessorId}
                    onChange={(event) =>
                      updateDependency(index, {
                        predecessorId: event.target.value,
                      })
                    }
                    disabled={isSaving}
                  >
                    {predecessorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {activityLabel(option)}
                      </option>
                    ))}
                  </select>

                  <select
                    className='h-9 rounded-md border bg-background px-2 text-sm'
                    value={dependency.relationshipType}
                    onChange={(event) =>
                      updateDependency(index, {
                        relationshipType: event.target
                          .value as DependencyRelationship,
                      })
                    }
                    disabled={isSaving}
                  >
                    {RELATIONSHIP_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>

                  <Input
                    type='number'
                    value={dependency.lagDays}
                    aria-label='Lag or lead days'
                    onChange={(event) =>
                      updateDependency(index, {
                        lagDays: Math.round(Number(event.target.value) || 0),
                      })
                    }
                    disabled={isSaving}
                  />

                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='size-8'
                    onClick={() => removeDependency(index)}
                    disabled={isSaving}
                    aria-label='Remove dependency'
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              ))}
              {dependencies.length === 0 && (
                <div className='rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground'>
                  No predecessors
                </div>
              )}
            </div>

            {dependencyError && (
              <p className='text-xs font-medium text-destructive'>
                Select each predecessor once.
              </p>
            )}

            <div className='grid gap-2 pt-1'>
              <p className='text-xs font-medium text-muted-foreground'>
                Successors
              </p>
              {successorRows.map((row) => (
                <div
                  key={`${row.successor.id}-${row.relationshipType}-${row.lagDays}`}
                  className='grid gap-2 rounded-md border bg-muted/20 p-2 text-sm sm:grid-cols-[1fr_78px_92px]'
                >
                  <span className='min-w-0 truncate'>
                    {activityLabel(row.successor)}
                  </span>
                  <span className='font-mono text-xs'>
                    {row.relationshipType}
                  </span>
                  <span className='font-mono text-xs'>
                    Lag {formatLag(row.lagDays)}d
                  </span>
                </div>
              ))}
              {successorRows.length === 0 && (
                <div className='rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground'>
                  No successors
                </div>
              )}
            </div>
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
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || dependencyError}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
