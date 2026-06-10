import { MailPlus, UserPlus } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { useSubscription } from '@/features/billing/hooks/use-billing'
import { useUsers } from './users-provider'

export function UsersPrimaryButtons() {
  const { setOpen } = useUsers()
  const canCreateUser = useCanPerform('user_management', 'create')
  const { data: subscription } = useSubscription()
  const subscriptionAllowsWrites = subscription?.hasAccess !== false

  if (!canCreateUser || !subscriptionAllowsWrites) return null

  return (
    <div className='flex gap-2'>
      <Button
        variant='outline'
        className='space-x-1'
        onClick={() => setOpen('invite')}
      >
        <span>Invite Engineer</span> <MailPlus size={18} />
      </Button>
      <Button className='space-x-1' onClick={() => setOpen('add')}>
        <span>Add Engineer</span> <UserPlus size={18} />
      </Button>
    </div>
  )
}
