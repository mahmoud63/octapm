import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { workspaceSegment } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import { useCreateWorkspace } from '../hooks/use-workspace'

/**
 * "Create workspace" (workspace switching doc §6, ENT-6): a further company
 * workspace for the signed-in identity, owned and administered by them.
 * On success the app navigates to the new workspace's home — the
 * `/o/$orgSlug` guard performs the session switch, so the URL stays the
 * source of truth and Back returns to the workspace the person came from.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const create = useCreateWorkspace()
  const trimmed = name.trim()

  const submit = async () => {
    if (trimmed.length < 2) return
    try {
      const result = await create.mutateAsync(trimmed)
      toast.success(`${result.organisation.name} is ready`)
      setName('')
      onOpenChange(false)
      navigate({
        to: '/o/$orgSlug',
        params: { orgSlug: workspaceSegment(result.workspace) },
      })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='sm:max-w-md'
        data-testid='create-workspace-dialog'
      >
        <DialogHeader>
          <DialogTitle>Create a company workspace</DialogTitle>
          <DialogDescription>
            A workspace for a team: you own and administer it, and can invite
            people into it. Your current workspace is untouched.
          </DialogDescription>
        </DialogHeader>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='create-workspace-name'>Workspace name</Label>
            <Input
              id='create-workspace-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Acme Contracting'
              autoFocus
              maxLength={120}
              data-testid='create-workspace-name'
            />
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={trimmed.length < 2 || create.isPending}
              data-testid='create-workspace-submit'
            >
              {create.isPending ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
