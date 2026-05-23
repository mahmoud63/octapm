import { PlansGrid } from './components/plans-grid'

export function BillingPlansPage() {
  return (
    <div className='mx-auto max-w-5xl p-6'>
      <h1 className='text-2xl font-bold'>Choose your plan</h1>
      <p className='text-muted-foreground mb-6'>
        Upgrade for more projects, AI generations, and team seats.
      </p>
      <PlansGrid />
    </div>
  )
}
