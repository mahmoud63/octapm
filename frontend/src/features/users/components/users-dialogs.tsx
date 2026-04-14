import { toast } from 'sonner'
import { useDeactivateUserMutation } from '../hooks/use-users'
import { UsersActionDialog } from './users-action-dialog'
import { UsersDeactivateDialog } from './users-deactivate-dialog'
import { UsersDeleteDialog } from './users-delete-dialog'
import { UsersInviteDialog } from './users-invite-dialog'
import { useUsers } from './users-provider'

export function UsersDialogs() {
  const { open, setOpen, currentRow, setCurrentRow } = useUsers()
  const deactivateMutation = useDeactivateUserMutation()

  const onDeactivateConfirm = async () => {
    if (!currentRow) {
      return
    }

    try {
      await deactivateMutation.mutateAsync(currentRow.id)
      toast.success('Engineer deactivated successfully.')
      setOpen(null)
      setCurrentRow(null)
    } catch {
      toast.error('Failed to deactivate engineer.')
    }
  }

  return (
    <>
      <UsersActionDialog
        key='user-add'
        open={open === 'add'}
        onOpenChange={(isOpen) => setOpen(isOpen ? 'add' : null)}
      />

      <UsersInviteDialog
        key='user-invite'
        open={open === 'invite'}
        onOpenChange={(isOpen) => setOpen(isOpen ? 'invite' : null)}
      />

      {currentRow && (
        <>
          <UsersDeactivateDialog
            key={`user-deactivate-${currentRow.id}`}
            open={open === 'deactivate'}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? 'deactivate' : null)
              if (!isOpen) {
                setTimeout(() => {
                  setCurrentRow(null)
                }, 200)
              }
            }}
            user={currentRow}
            onConfirm={onDeactivateConfirm}
          />

          <UsersActionDialog
            key={`user-edit-${currentRow.id}`}
            open={open === 'edit'}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? 'edit' : null)
              if (!isOpen) {
                setTimeout(() => {
                  setCurrentRow(null)
                }, 200)
              }
            }}
            currentRow={currentRow}
          />

          <UsersDeleteDialog
            key={`user-delete-${currentRow.id}`}
            open={open === 'delete'}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? 'delete' : null)
              if (!isOpen) {
                setTimeout(() => {
                  setCurrentRow(null)
                }, 200)
              }
            }}
            currentRow={currentRow}
          />
        </>
      )}
    </>
  )
}
