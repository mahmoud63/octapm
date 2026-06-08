import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { useSubscription } from '../hooks/use-billing'

export function SubscriptionBanner() {
  const { data: sub } = useSubscription()
  const navigate = useNavigate()
  if (!sub) return null

  if (sub.status === 'expired' || sub.status === 'incomplete') {
    const msg =
      sub.status === 'incomplete'
        ? 'Start your free trial to begin using PM Copilots.'
        : 'Your free trial has ended. Subscribe to continue using PM Copilots.'
    return (
      <div className='bg-destructive text-destructive-foreground flex items-center justify-between gap-4 px-4 py-2 text-sm'>
        <span>{msg}</span>
        <Button size='sm' variant='secondary' onClick={() => navigate({ to: '/billing' })}>
          Subscribe now
        </Button>
      </div>
    )
  }

  if (sub.status === 'past_due') {
    return (
      <div className='flex items-center justify-between gap-4 bg-amber-500 px-4 py-2 text-sm text-white'>
        <span>Your last payment failed. Update your card to keep access.</span>
        <Button size='sm' variant='secondary' onClick={() => navigate({ to: '/settings/billing' })}>
          Fix payment
        </Button>
      </div>
    )
  }
  return null
}
