import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { PaymentForm } from './payment-form'
import { useSubscription, useSubscribe, useStartTrial } from '../hooks/use-billing'
import type { BillingCycle } from '@/services/billing/types'

const PRICES = {
  individual: { monthly: 49, annual: 39 },
  business: { monthly: 499, annual: 399 },
}

export function CheckoutWizard({ plan }: { plan: 'individual' | 'business' }) {
  const navigate = useNavigate()
  const { data: sub } = useSubscription()
  const subscribe = useSubscribe()
  const startTrial = useStartTrial()

  const [step, setStep] = useState<2 | 3>(2)
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [setupSecret, setSetupSecret] = useState<string | undefined>(undefined)
  const [serverError, setServerError] = useState<string | null>(null)

  const hasCardOnFile = Boolean(sub?.paymentMethod?.last4)
  const price = PRICES[plan][cycle]

  const goToPayment = async () => {
    setServerError(null)
    if (!hasCardOnFile) {
      try {
        const { clientSecret } = await startTrial.mutateAsync()
        setSetupSecret(clientSecret)
      } catch {
        toast.error('Could not start payment setup.')
        return
      }
    }
    setStep(3)
  }

  const finish = () => {
    setServerError(null)
    subscribe.mutate(
      { plan, billingCycle: cycle },
      {
        onSuccess: () => {
          toast.success('Subscription active. Welcome aboard!')
          navigate({ to: '/settings/billing' })
        },
        onError: (err: any) => {
          const code = err?.response?.data?.error?.code
          const msg = err?.response?.data?.error?.message
          setServerError(
            code === 'CARD_DECLINED'
              ? 'Your card was declined. Please contact your card issuer.'
              : msg || 'Payment failed. Please try again.'
          )
        },
      }
    )
  }

  const planName = plan === 'individual' ? 'Individual' : 'Business'

  return (
    <div className='mx-auto max-w-2xl space-y-6 p-6'>
      <h1 className='text-2xl font-bold'>Subscribe to {planName}</h1>

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>Step 2 of 3 · Choose billing cycle</CardTitle></CardHeader>
          <CardContent className='space-y-3'>
            {(['monthly', 'annual'] as BillingCycle[]).map((c) => (
              <button
                key={c}
                type='button'
                onClick={() => setCycle(c)}
                className={`w-full rounded-lg border p-4 text-left ${
                  cycle === c ? 'border-primary ring-primary/30 ring-2' : 'border-border'
                }`}
              >
                <div className='flex justify-between font-medium'>
                  <span className='capitalize'>{c}</span>
                  <span>${PRICES[plan][c]} /mo</span>
                </div>
                {c === 'annual' && (
                  <div className='text-sm text-green-600'>Save 20% · billed yearly</div>
                )}
              </button>
            ))}
            <Button className='w-full' onClick={goToPayment} disabled={startTrial.isPending}>
              {startTrial.isPending ? 'Preparing…' : 'Continue to payment'}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle>Step 3 of 3 · Payment</CardTitle></CardHeader>
          <CardContent className='space-y-4'>
            <div className='bg-muted rounded-md p-4 text-sm'>
              <div className='flex justify-between'>
                <span>{planName} · {cycle}</span><span>${price} /mo</span>
              </div>
              {hasCardOnFile && (
                <div className='text-muted-foreground mt-2'>
                  Using card on file ending {sub?.paymentMethod?.last4}
                </div>
              )}
            </div>
            <Elements stripe={stripePromise}>
              <PaymentForm
                setupClientSecret={setupSecret}
                onConfirmed={finish}
                submitLabel={`Pay $${price}`}
                busy={subscribe.isPending}
                serverError={serverError}
              />
            </Elements>
            <Button variant='ghost' className='w-full' onClick={() => setStep(2)}>
              Back
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
