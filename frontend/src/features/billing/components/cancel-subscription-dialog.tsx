import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useCancelSubscription } from '../hooks/use-billing'

type Props = {
  open: boolean
  onOpenChange: (o: boolean) => void
  planName: string
  periodEnd: string | null
}

export function CancelSubscriptionDialog({ open, onOpenChange, planName, periodEnd }: Props) {
  const cancel = useCancelSubscription()
  const endLabel = periodEnd
    ? new Date(periodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'the end of the billing period'

  const confirm = () =>
    cancel.mutate(undefined, {
      onSuccess: () => {
        toast.success('Subscription canceled.')
        onOpenChange(false)
      },
      onError: () => toast.error('Could not cancel. Please try again.'),
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel your subscription?</DialogTitle></DialogHeader>
        <p className='text-sm'>
          Your <strong>{planName}</strong> subscription will remain active until{' '}
          <strong>{endLabel}</strong>. After that, your account will be downgraded
          and you will lose access to paid features.
        </p>
        <div className='bg-muted rounded-md p-3 text-sm'>
          <strong>Your data is safe.</strong> We'll keep your projects for 90 days
          in case you change your mind.
        </div>
        <div className='space-y-2'>
          <Button className='w-full' onClick={() => onOpenChange(false)}>
            Keep subscription
          </Button>
          <Button
            variant='ghost'
            className='text-destructive w-full'
            onClick={confirm}
            disabled={cancel.isPending}
          >
            {cancel.isPending ? 'Canceling…' : 'Yes, cancel'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
