import { isEndedSession } from '@/services/api/client'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  isRateLimited,
  useSendPasswordResetEmailMutation,
} from '../hooks/use-users'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userName: string
}

/**
 * Asks OctaPM to e-mail the person the ordinary self-service reset link
 * (owner decision D-ID-1 Q4). The administrator never sets or sees a
 * password, and the answer is the same whatever state the account is in.
 */
export function UsersSendResetEmailDialog({
  open,
  onOpenChange,
  userId,
  userName,
}: Props) {
  const sendResetEmail = useSendPasswordResetEmailMutation()

  const handleConfirm = () => {
    sendResetEmail.mutate(userId, {
      onSuccess: () => {
        toast.success(
          `If ${userName}'s account is active, a password-reset e-mail is on its way.`
        )
        onOpenChange(false)
      },
      onError: (error) => {
        // An ended session was already announced by the request layer (D-ID-1 N4).
        if (isEndedSession(error)) return
        toast.error(
          isRateLimited(error)
            ? 'Too many reset e-mails were asked for recently. Please wait a while and try again.'
            : getServerErrorMessage(error, 'Could not send the reset e-mail.')
        )
      },
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Send password-reset e-mail?'
      desc={
        <p>
          {userName} will receive an e-mail with a link to choose a new
          password. You never see or set their password, and their current
          sessions end once they reset it.
        </p>
      }
      confirmText={
        sendResetEmail.isPending ? 'Sending…' : 'Send reset e-mail'
      }
      isLoading={sendResetEmail.isPending}
      handleConfirm={handleConfirm}
    />
  )
}
