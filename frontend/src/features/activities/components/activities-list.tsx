import { useState } from 'react'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { MaterialsSection } from '@/features/materials/components/materials-section'
import type { Activity } from '../data/schema'
import { useActivities, useDeleteActivity } from '../hooks/use-activities'
import { ActivityCreateDialog } from './activity-create-dialog'
import { ActivityDeleteDialog } from './activity-delete-dialog'
import { ActivityEditDialog } from './activity-edit-dialog'
import { ActivityStatusBadge } from './activity-status-badge'

type ActivitiesListProps = {
  projectId: string
  projectStartDate?: string | null
  projectEndDate?: string | null
}

const formatDate = (value: string | null) => {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleDateString()
}

const formatNumber = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })

export function ActivitiesList({
  projectId,
  projectStartDate,
  projectEndDate,
}: ActivitiesListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editActivity, setEditActivity] = useState<Activity | null>(null)
  const [deleteActivity, setDeleteActivity] = useState<Activity | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(
    null
  )
  const removeActivity = useDeleteActivity(projectId)

  const { data: activities = [], isLoading } = useActivities(projectId)

  const onDelete = async () => {
    if (!deleteActivity) {
      return
    }

    try {
      await removeActivity.mutateAsync(deleteActivity.id)
      toast.success('Activity deleted successfully.')
      if (selectedActivity?.id === deleteActivity.id) {
        setSelectedActivity(null)
      }
      setDeleteActivity(null)
    } catch (error) {
      if (error instanceof AxiosError) {
        const errorData = error.response?.data as
          | { error?: { message?: string } }
          | undefined

        toast.error(errorData?.error?.message ?? 'Failed to delete activity')
        return
      }

      toast.error('Failed to delete activity')
    }
  }

  if (isLoading) {
    return (
      <div className='py-8 text-center text-muted-foreground'>
        Loading activities...
      </div>
    )
  }

  return (
    <>
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold'>Activities</h2>
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          + Add Activity
        </Button>
      </div>

      {activities.length === 0 ? (
        <div className='mt-4 flex flex-col items-center justify-center rounded-md border py-16 text-center'>
          <p className='mb-3 text-muted-foreground'>No activities yet.</p>
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            + Add Activity
          </Button>
        </div>
      ) : (
        <div className='mt-4 overflow-hidden rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='border-b bg-muted/50'>
              <tr>
                <th className='p-3 text-left font-medium'>Activity</th>
                <th className='p-3 text-left font-medium'>Category</th>
                <th className='p-3 text-left font-medium'>Start</th>
                <th className='p-3 text-left font-medium'>End</th>
                <th className='p-3 text-left font-medium'>Progress</th>
                <th className='p-3 text-right font-medium'>BOQ Value</th>
                <th className='p-3 text-left font-medium'>Status</th>
                <th className='p-3 text-left font-medium'>Engineers</th>
                <th className='p-3 text-left font-medium'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr
                  key={activity.id}
                  className='cursor-pointer border-b hover:bg-muted/25'
                  onClick={() => setSelectedActivity(activity)}
                >
                  <td className='p-3 font-medium'>
                    {activity.isMilestone && (
                      <span className='mr-1 text-yellow-500'>*</span>
                    )}
                    {activity.name}
                  </td>
                  <td className='p-3 text-muted-foreground'>
                    {activity.category ?? '-'}
                  </td>
                  <td className='p-3 text-muted-foreground'>
                    {formatDate(activity.startDate)}
                  </td>
                  <td className='p-3 text-muted-foreground'>
                    {formatDate(activity.endDate)}
                  </td>
                  <td className='p-3'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-20 rounded-full bg-muted'>
                        <div
                          className='h-2 rounded-full bg-primary'
                          style={{ width: `${activity.pctComplete}%` }}
                        />
                      </div>
                      <span className='text-xs text-muted-foreground'>
                        {activity.pctComplete}%
                      </span>
                    </div>
                  </td>
                  <td className='p-3 text-right text-muted-foreground'>
                    {formatNumber(activity.allocatedBoqAmount)}
                  </td>
                  <td className='p-3'>
                    <ActivityStatusBadge status={activity.status} />
                  </td>
                  <td className='p-3 text-xs text-muted-foreground'>
                    {activity.assignedEngineers
                      .map((engineer) => engineer.name)
                      .join(', ') || '-'}
                  </td>
                  <td className='p-3'>
                    <div className='flex items-center gap-1'>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={(event) => {
                          event.stopPropagation()
                          setEditActivity(activity)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-destructive hover:text-destructive'
                        onClick={(event) => {
                          event.stopPropagation()
                          setDeleteActivity(activity)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ActivityCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        projectStartDate={projectStartDate}
        projectEndDate={projectEndDate}
      />

      <ActivityEditDialog
        open={Boolean(editActivity)}
        onOpenChange={(open) => {
          if (!open) {
            setEditActivity(null)
          }
        }}
        projectId={projectId}
        activity={editActivity}
        projectStartDate={projectStartDate}
        projectEndDate={projectEndDate}
        onSaved={() => {
          setSelectedActivity(null)
        }}
      />

      <ActivityDeleteDialog
        open={Boolean(deleteActivity)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteActivity(null)
          }
        }}
        activity={deleteActivity}
        onConfirm={onDelete}
        isDeleting={removeActivity.isPending}
      />

      <Sheet
        open={Boolean(selectedActivity)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedActivity(null)
          }
        }}
      >
        {selectedActivity && (
          <SheetContent className='sm:max-w-2xl'>
            <SheetHeader>
              <SheetTitle>{selectedActivity.name}</SheetTitle>
              <SheetDescription>
                {selectedActivity.category ?? 'Uncategorized'} |{' '}
                {formatDate(selectedActivity.startDate)}
                {' -> '}
                {formatDate(selectedActivity.endDate)}
              </SheetDescription>
            </SheetHeader>

            <div className='flex-1 space-y-6 overflow-y-auto px-4 pb-4'>
              <div className='grid grid-cols-1 gap-3 rounded-md border p-3 text-sm sm:grid-cols-2'>
                <div>
                  <p className='text-muted-foreground'>Status</p>
                  <ActivityStatusBadge status={selectedActivity.status} />
                </div>
                <div>
                  <p className='text-muted-foreground'>Progress</p>
                  <p className='font-medium'>{selectedActivity.pctComplete}%</p>
                </div>
                <div>
                  <p className='text-muted-foreground'>Approved BOQ Value</p>
                  <p className='font-medium'>
                    {formatNumber(selectedActivity.allocatedBoqAmount)}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground'>Approved BOQ Weight</p>
                  <p className='font-medium'>
                    {formatNumber(selectedActivity.allocatedBoqWeight)}%
                  </p>
                </div>
                <div className='sm:col-span-2'>
                  <p className='text-muted-foreground'>Assigned Engineers</p>
                  <p>
                    {selectedActivity.assignedEngineers
                      .map((engineer) => `${engineer.name} (${engineer.email})`)
                      .join(', ') || '-'}
                  </p>
                </div>
              </div>

              <MaterialsSection
                projectId={projectId}
                activityId={selectedActivity.id}
              />
            </div>
          </SheetContent>
        )}
      </Sheet>
    </>
  )
}
