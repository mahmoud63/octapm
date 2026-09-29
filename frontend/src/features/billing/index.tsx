import { PlansGrid } from './components/plans-grid'
import { StartTrialCard } from './components/start-trial-card'
import { useSubscription } from './hooks/use-billing'

export function BillingPlansPage() {
  const { data: sub } = useSubscription()
  const showTrialGate = sub?.status === 'incomplete'

  return (
    <div className='mx-auto max-w-5xl space-y-6 p-6'>
      <h1 className='text-2xl font-bold'>Choose your plan</h1>
      <p className='text-muted-foreground mb-6'>
        Upgrade for more projects, AI generations, and team seats.
      </p>
      {sub && !sub.recognized && (
        <div className='border-destructive rounded-md border p-4 text-sm' data-testid='subscription-plan-fault'>
          <p className='font-semibold'>Subscription plan: configuration issue</p>
          <p className='text-muted-foreground'>
            Your current plan{sub.plan ? ` (${sub.plan})` : ''} is not one we recognise, so its limits are
            unavailable — contact your administrator.
          </p>
        </div>
      )}
      {showTrialGate && <StartTrialCard />}
      <PlansGrid />
    </div>
  )
}
