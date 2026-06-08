import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check } from 'lucide-react'
import { usePlans } from '../hooks/use-billing'
import { EnterpriseSeatDialog } from './enterprise-seat-dialog'
import type { PlanCard } from '@/services/billing/types'

const FEATURES: Record<string, string[]> = {
  individual: ['Full access to all modules', 'BOQ to CPM generation', 'Cost and progress tracking', '1 user seat', 'Email support'],
  business: ['Everything in Individual', 'Up to 10 user seats', 'Team collaboration and roles', 'Priority support'],
  enterprise: ['Everything in Business', 'Unlimited user seats', 'SSO, SOC2, audit logs, SLA', 'Dedicated account manager'],
}

export function PlansGrid() {
  const { data, isLoading } = usePlans()
  const navigate = useNavigate()
  const [enterpriseOpen, setEnterpriseOpen] = useState(false)

  if (isLoading || !data) return <div className='p-8 text-center'>Loading plans…</div>

  return (
    <div className='space-y-6'>
      <div className='grid gap-6 md:grid-cols-3'>
        {data.plans.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            features={FEATURES[plan.id] ?? []}
            onChoose={() => {
              if (plan.isEnterprise) setEnterpriseOpen(true)
              else if (!plan.isCurrent) {
                navigate({ to: '/billing/checkout', search: { plan: plan.id as 'individual' | 'business' } })
              }
            }}
          />
        ))}
      </div>
      <EnterpriseSeatDialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen} />
    </div>
  )
}

function PlanColumn({
  plan, features, onChoose,
}: { plan: PlanCard; features: string[]; onChoose: () => void }) {
  return (
    <Card className={plan.isCurrent ? 'border-muted' : 'border-primary'}>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle>{plan.name}</CardTitle>
          {plan.isCurrent && <Badge variant='secondary'>Current plan</Badge>}
        </div>
        <div className='text-3xl font-bold'>
          {plan.isEnterprise ? 'Custom' : `$${plan.monthly}`}
          {!plan.isEnterprise && <span className='text-muted-foreground text-base'> /mo</span>}
        </div>
        <p className='text-muted-foreground text-sm'>
          {plan.projectLimit ? `Up to ${plan.projectLimit} projects` : 'Custom project volume'}
        </p>
      </CardHeader>
      <CardContent className='space-y-4'>
        <ul className='space-y-2 text-sm'>
          {features.map((f) => (
            <li key={f} className='flex gap-2'>
              <Check className='text-primary h-4 w-4 shrink-0' /> {f}
            </li>
          ))}
        </ul>
        <Button
          className='w-full'
          variant={plan.isCurrent ? 'outline' : 'default'}
          disabled={plan.isCurrent}
          onClick={onChoose}
        >
          {plan.isCurrent ? 'Active' : plan.isEnterprise ? 'Get Enterprise plan' : `Choose ${plan.name}`}
        </Button>
      </CardContent>
    </Card>
  )
}
