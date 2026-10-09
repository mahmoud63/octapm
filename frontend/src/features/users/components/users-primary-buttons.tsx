import { MailPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSubscription } from '@/features/billing/hooks/use-billing'
import { useCanInvite } from '../hooks/use-users'
import { useUsers } from './users-provider'

/**
 * One way in: adding a person is always an invitation (owner decision
 * D-ID-1). The person chooses their own password when they accept.
 */
export function UsersPrimaryButtons() {
  const { setOpen } = useUsers()
  const canInvite = useCanInvite()
  const { data: subscription } = useSubscription()
  const subscriptionAllowsWrites = subscription?.hasAccess !== false

  if (!canInvite || !subscriptionAllowsWrites) return null

  return (
    <div className='flex gap-2'>
      <Button
        className='space-x-1'
        onClick={() => setOpen('invite')}
        data-testid='uat-users-invite'
      >
        <span>Invite by email</span> <MailPlus size={18} />
      </Button>
    </div>
  )
}
