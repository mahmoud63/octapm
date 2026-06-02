import { useState } from 'react'
import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

type Props = {
  setupClientSecret?: string
  onConfirmed: (paymentMethodId?: string) => void
  submitLabel: string
  busy: boolean
  serverError?: string | null
}

export function PaymentForm({
  setupClientSecret, onConfirmed, submitLabel, busy, serverError,
}: Props) {
  const stripe = useStripe()
  const elements = useElements()
  const [cardError, setCardError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const handleSubmit = async () => {
    setCardError(null)
    if (!setupClientSecret) {
      onConfirmed()
      return
    }
    if (!stripe || !elements) return
    const card = elements.getElement(CardElement)
    if (!card) return

    setConfirming(true)
    const result = await stripe.confirmCardSetup(setupClientSecret, {
      payment_method: { card },
    })
    setConfirming(false)

    if (result.error) {
      if (
        result.error.code === 'setup_intent_unexpected_state' &&
        result.error.setup_intent?.status === 'succeeded'
      ) {
        const pmId = typeof result.error.setup_intent.payment_method === 'string'
          ? result.error.setup_intent.payment_method
          : result.error.setup_intent.payment_method?.id
        
        onConfirmed(pmId)
        return
      }
      setCardError(result.error.message ?? 'Please check your card details.')
      return
    }
    const pmId = typeof result.setupIntent?.payment_method === 'string'
      ? result.setupIntent.payment_method
      : undefined
    onConfirmed(pmId)
  }

  return (
    <div className='space-y-4'>
      {setupClientSecret && (
        <div className='rounded-md border p-3'>
          <CardElement options={{ hidePostalCode: false }} />
        </div>
      )}
      {cardError && (
        <Alert variant='destructive'><AlertDescription>{cardError}</AlertDescription></Alert>
      )}
      {serverError && (
        <Alert variant='destructive'><AlertDescription>{serverError}</AlertDescription></Alert>
      )}
      <Button
        className='w-full'
        disabled={busy || confirming || (!!setupClientSecret && !stripe)}
        onClick={handleSubmit}
      >
        {busy || confirming ? 'Processing…' : submitLabel}
      </Button>
      <p className='text-muted-foreground text-center text-xs'>
        Secured by Stripe · 256-bit encryption
      </p>
    </div>
  )
}
