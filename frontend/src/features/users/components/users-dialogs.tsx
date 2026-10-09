import { isEndedSession } from '@/services/api/client'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useDeactivateUserMutation } from '../hooks/use-users'
import { UsersActionDialog } from './users-action-dialog'
import { UsersDeactivateDialog } from './users-deactivate-dialog'
import { UsersDeleteDialog } from './users-delete-dialog'
import { UsersInviteDialog } from './users-invite-dialog'
import { useUsers } from './users-provider'
import { UsersSendResetEmailDialog } from './users-send-reset-email-dialog'

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
    } catch (error) {
      // An ended session was already announced by the request layer (D-ID-1 N4).
      if (isEndedSession(error)) return
      toast.error(getServerErrorMessage(error, 'Failed to deactivate engineer.'))
    }
  }

  return (
    <>
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

          <UsersSendResetEmailDialog
            key={`user-send-reset-email-${currentRow.id}`}
            open={open === 'sendResetEmail'}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? 'sendResetEmail' : null)
              if (!isOpen) {
                setTimeout(() => {
                  setCurrentRow(null)
                }, 200)
              }
            }}
            userId={currentRow.id}
            userName={currentRow.name}
          />
        </>
      )}
    </>
  )
}
