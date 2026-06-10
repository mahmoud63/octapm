import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { type Row } from '@tanstack/react-table'
import { KeyRound, Pencil, Trash2, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { useSubscription } from '@/features/billing/hooks/use-billing'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type User } from '../data/schema'
import { useActivateUserMutation } from '../hooks/use-users'
import { useUsers } from './users-provider'

type DataTableRowActionsProps = {
  row: Row<User>
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const { setOpen, setCurrentRow } = useUsers()
  const canUpdateUser = useCanPerform('user_management', 'update')
  const canDeleteUser = useCanPerform('user_management', 'delete')
  const activateMutation = useActivateUserMutation()
  const { data: subscription } = useSubscription()
  const subscriptionAllowsWrites = subscription?.hasAccess !== false

  const onActivate = async () => {
    try {
      await activateMutation.mutateAsync(row.original.id)
      toast.success('Engineer activated successfully.')
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Failed to activate engineer.'))
    }
  }

  const onDeactivate = () => {
    setCurrentRow(row.original)
    setOpen('deactivate')
  }

  if ((!canUpdateUser && !canDeleteUser) || !subscriptionAllowsWrites) {
    return null
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          className='flex h-8 w-8 p-0 data-[state=open]:bg-muted'
        >
          <DotsHorizontalIcon className='h-4 w-4' />
          <span className='sr-only'>Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-45'>
        {canUpdateUser && (
          <DropdownMenuItem
            onClick={() => {
              setCurrentRow(row.original)
              setOpen('edit')
            }}
          >
            Edit
            <DropdownMenuShortcut>
              <Pencil size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}

        {canUpdateUser &&
          (row.original.status === 'active' ? (
            <DropdownMenuItem
              className='text-destructive!'
              onClick={onDeactivate}
            >
              Deactivate
              <DropdownMenuShortcut>
                <UserX size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onActivate}>
              Activate
              <DropdownMenuShortcut>
                <UserCheck size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}

        {canUpdateUser && (
          <DropdownMenuItem
            onClick={() => {
              setCurrentRow(row.original)
              setOpen('resetPassword')
            }}
          >
            Reset Password
            <DropdownMenuShortcut>
              <KeyRound size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}

        {canUpdateUser && canDeleteUser && <DropdownMenuSeparator />}

        {canDeleteUser && (
          <DropdownMenuItem
            onClick={() => {
              setCurrentRow(row.original)
              setOpen('delete')
            }}
            className='text-red-500!'
          >
            Delete
            <DropdownMenuShortcut>
              <Trash2 size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
