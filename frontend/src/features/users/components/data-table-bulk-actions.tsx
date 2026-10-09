import { useState } from 'react'
import { type Table } from '@tanstack/react-table'
import { Trash2, UserX, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useCanPerform } from '@/lib/permissions'
import { sleep } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { type User } from '../data/schema'
import { UsersMultiDeleteDialog } from './users-multi-delete-dialog'

type DataTableBulkActionsProps<TData> = {
  table: Table<TData>
}

export function DataTableBulkActions<TData>({
  table,
}: DataTableBulkActionsProps<TData>) {
  const canUpdateUser = useCanPerform('user_management', 'update')
  const canDeleteUser = useCanPerform('user_management', 'delete')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const selectedRows = table.getFilteredSelectedRowModel().rows

  if (!canUpdateUser && !canDeleteUser) return null

  const handleBulkStatusChange = (status: 'active' | 'inactive') => {
    const selectedUsers = selectedRows.map((row) => row.original as User)
    toast.promise(sleep(2000), {
      loading: `${status === 'active' ? 'Activating' : 'Deactivating'} users...`,
      success: () => {
        table.resetRowSelection()
        return `${status === 'active' ? 'Activated' : 'Deactivated'} ${selectedUsers.length} user${selectedUsers.length > 1 ? 's' : ''}`
      },
      error: `Error ${status === 'active' ? 'activating' : 'deactivating'} users`,
    })
    table.resetRowSelection()
  }

  // No bulk "invite": the people listed here are already in the workspace,
  // and adding a person is one invitation at a time (owner decision D-ID-1).
  return (
    <>
      <BulkActionsToolbar table={table} entityName='user'>
        {canUpdateUser && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='icon'
                onClick={() => handleBulkStatusChange('active')}
                className='size-8'
                aria-label='Activate selected users'
                title='Activate selected users'
              >
                <UserCheck />
                <span className='sr-only'>Activate selected users</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Activate selected users</p>
            </TooltipContent>
          </Tooltip>
        )}

        {canUpdateUser && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='icon'
                onClick={() => handleBulkStatusChange('inactive')}
                className='size-8'
                aria-label='Deactivate selected users'
                title='Deactivate selected users'
              >
                <UserX />
                <span className='sr-only'>Deactivate selected users</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Deactivate selected users</p>
            </TooltipContent>
          </Tooltip>
        )}

        {canDeleteUser && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='destructive'
                size='icon'
                onClick={() => setShowDeleteConfirm(true)}
                className='size-8'
                aria-label='Delete selected users'
                title='Delete selected users'
              >
                <Trash2 />
                <span className='sr-only'>Delete selected users</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete selected users</p>
            </TooltipContent>
          </Tooltip>
        )}
      </BulkActionsToolbar>

      <UsersMultiDeleteDialog
        table={table}
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
      />
    </>
  )
}
