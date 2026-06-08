import { useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { PaymentForm } from './payment-form'
import { useStartTrial, useConfirmTrial } from '../hooks/use-billing'

export function StartTrialCard() {
  const startTrial = useStartTrial()
  const confirmTrial = useConfirmTrial()
  const [secret, setSecret] = useState<string | undefined>(undefined)

  const begin = async () => {
    try {
      const { clientSecret } = await startTrial.mutateAsync()
      setSecret(clientSecret)
    } catch {
      toast.error('Could not start the trial. Please try again.')
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Start your 7-day free trial</CardTitle></CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-muted-foreground text-sm'>
          Your card will not be charged during the trial. You can cancel any time
          before day 7 at no cost.
        </p>
        {!secret ? (
          <button
            className='bg-primary text-primary-foreground w-full rounded-md py-2'
            onClick={begin}
            disabled={startTrial.isPending}
          >
            {startTrial.isPending ? 'Preparing…' : 'Add card & start trial'}
          </button>
        ) : (
          <Elements stripe={stripePromise}>
            <PaymentForm
              setupClientSecret={secret}
              submitLabel='Start free trial'
              busy={confirmTrial.isPending}
              onConfirmed={(pmId) => {
                if (!pmId) {
                  toast.error('Could not finish trial setup.')
                  return
                }
                confirmTrial.mutate(pmId, {
                  onSuccess: () => {
                    toast.success('Trial started. Welcome!')
                    setSecret(undefined)
                  },
                  onError: () => toast.error('Could not finish trial setup.'),
                })
              }}
            />
          </Elements>
        )}
      </CardContent>
    </Card>
  )
}
