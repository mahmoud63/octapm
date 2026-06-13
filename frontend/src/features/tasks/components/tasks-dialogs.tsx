import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TasksMutateDrawer } from './tasks-mutate-drawer'
import { useTasks } from './tasks-provider'
import { useDeleteTask } from '../hooks/use-tasks'

export function TasksDialogs() {
  const { open, setOpen, currentRow, setCurrentRow } = useTasks()
  const deleteTask = useDeleteTask()

  return (
    <>
      <TasksMutateDrawer
        key='task-create'
        open={open === 'create'}
        onOpenChange={(isOpen) => setOpen(isOpen ? 'create' : null)}
      />

      {currentRow && (
        <>
          <TasksMutateDrawer
            key={`task-update-${currentRow.id}`}
            open={open === 'update'}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? 'update' : null)
              if (!isOpen) {
                setTimeout(() => {
                  setCurrentRow(null)
                }, 500)
              }
            }}
            currentRow={currentRow}
          />

          <ConfirmDialog
            key='task-delete'
            destructive
            open={open === 'delete'}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? 'delete' : null)
              if (!isOpen) {
                setTimeout(() => {
                  setCurrentRow(null)
                }, 500)
              }
            }}
            handleConfirm={async () => {
              try {
                await deleteTask.mutateAsync(currentRow.id)
                toast.success(`${currentRow.taskNumber} archived`)
                setOpen(null)
                setTimeout(() => {
                  setCurrentRow(null)
                }, 500)
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Task could not be archived.'
                toast.error(message)
              }
            }}
            className='max-w-md'
            title={`Archive ${currentRow.taskNumber}?`}
            desc={
              <>
                You are about to archive{' '}
                <strong>{currentRow.taskNumber}</strong>. Comments,
                attachments, and history will be retained.
              </>
            }
            confirmText='Archive'
          />
        </>
      )}
    </>
  )
}
