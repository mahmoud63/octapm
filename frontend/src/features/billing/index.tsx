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
      {showTrialGate && <StartTrialCard />}
      <PlansGrid />
    </div>
  )
}
