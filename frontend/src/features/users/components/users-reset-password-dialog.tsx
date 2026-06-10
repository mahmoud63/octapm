import { useState } from 'react'
import { toast } from 'sonner'
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
import { useResetPasswordMutation } from '../hooks/use-users'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userName: string
}

export function UsersResetPasswordDialog({
  open,
  onOpenChange,
  userId,
  userName,
}: Props) {
  const [password, setPassword] = useState('')
  const resetPassword = useResetPasswordMutation()

  const valid =
    password.length >= 8 && /[a-z]/.test(password) && /[0-9]/.test(password)

  const handleSubmit = () => {
    resetPassword.mutate(
      { userId, newPassword: password },
      {
        onSuccess: () => {
          toast.success(`Password reset for ${userName}`)
          setPassword('')
          onOpenChange(false)
        },
        onError: (error) =>
          toast.error(getServerErrorMessage(error, 'Could not reset password')),
      }
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(state) => {
        if (!state) {
          setPassword('')
        }
        onOpenChange(state)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {userName}. They will use it on their next
            login.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='new-password'>New password</Label>
          <Input
            id='new-password'
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder='At least 8 chars, 1 letter, 1 number'
          />
          {password.length > 0 && !valid && (
            <p className='text-destructive text-sm'>
              Must be 8+ characters and include a lowercase letter and a number.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || resetPassword.isPending}
            onClick={handleSubmit}
          >
            {resetPassword.isPending ? 'Resetting…' : 'Reset password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
