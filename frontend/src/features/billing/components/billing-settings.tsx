import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Subscription } from '@/services/billing/types'
import { useSubscription, useTransactions } from '../hooks/use-billing'
import { CancelSubscriptionDialog } from './cancel-subscription-dialog'

export function BillingSettings() {
  const { data: sub, isLoading } = useSubscription()
  const { data: transactions } = useTransactions()
  const navigate = useNavigate()
  const [cancelOpen, setCancelOpen] = useState(false)

  if (isLoading || !sub) return <div className='p-6'>Loading billing…</div>

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle>Current plan</CardTitle>
            <Badge variant={sub.status === 'active' ? 'default' : 'secondary'}>
              {sub.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          <PlanSummary sub={sub} />
          {sub.status === 'trialing' && sub.trialEndsAt && (
            <p className='text-muted-foreground text-sm'>
              Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}
            </p>
          )}
          {sub.cancelAtPeriodEnd && sub.currentPeriodEnd && (
            <p className='text-destructive text-sm'>
              Cancels on {new Date(sub.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
          <div className='flex gap-2'>
            <Button onClick={() => navigate({ to: '/billing' })}>
              {sub.status === 'active' ? 'Change plan' : 'View plans'}
            </Button>
            {sub.status === 'active' && !sub.cancelAtPeriodEnd && (
              <Button variant='outline' onClick={() => setCancelOpen(true)}>
                Cancel subscription
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment method</CardTitle></CardHeader>
        <CardContent>
          {sub.paymentMethod?.last4 ? (
            <p className='text-sm'>
              {sub.paymentMethod.brand?.toUpperCase()} ···· {sub.paymentMethod.last4}
              {' '}(exp {sub.paymentMethod.expMonth}/{sub.paymentMethod.expYear})
            </p>
          ) : (
            <p className='text-muted-foreground text-sm'>No card on file.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transaction history</CardTitle></CardHeader>
        <CardContent>
          {!transactions?.length ? (
            <p className='text-muted-foreground text-sm'>No payments yet.</p>
          ) : (
            <ul className='divide-y'>
              {transactions.map((t) => (
                <li key={t.id} className='flex items-center justify-between py-3'>
                  <div>
                    <div className='font-medium'>{t.description}</div>
                    <div className='text-muted-foreground text-sm'>
                      {new Date(t.date).toLocaleDateString()}
                    </div>
                  </div>
                  <div className={t.status === 'failed' ? 'text-destructive' : ''}>
                    ${t.amount.toFixed(2)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CancelSubscriptionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        planName={sub.planName ?? 'current'}
        periodEnd={sub.currentPeriodEnd}
      />
    </div>
  )
}

const limitLabel = (limit: number | null, noun: string) =>
  limit === null ? `Unlimited ${noun}` : `Up to ${limit} ${noun}`

/**
 * The plan and its limits, as the server read them. A plan the catalogue
 * does not contain is a configuration issue — shown as one, with no limits
 * and no tier name, never as a trial (docs/qa/OCTAPM_ISSUE_PLAN-CATALOGUE-UAT.md).
 */
export function PlanSummary({ sub }: { sub: Subscription }) {
  if (!sub.recognized || !sub.limits) {
    return (
      <div className='space-y-1' data-testid='subscription-plan-fault'>
        <div className='text-destructive text-lg font-semibold' data-testid='subscription-plan'>
          Subscription plan: configuration issue
        </div>
        {sub.plan && (
          <p className='text-muted-foreground text-sm'>
            Stored plan: <code>{sub.plan}</code>
          </p>
        )}
        <p className='text-sm' data-testid='subscription-limits'>
          Limits unavailable — contact your administrator.
        </p>
        {sub.configurationError?.message && (
          <p className='text-muted-foreground text-sm'>{sub.configurationError.message}</p>
        )}
      </div>
    )
  }
  return (
    <div className='space-y-1'>
      <div className='text-lg font-semibold' data-testid='subscription-plan'>
        {sub.planName}{sub.billingCycle ? ` · ${sub.billingCycle}` : ''}
      </div>
      <p className='text-muted-foreground text-sm' data-testid='subscription-limits'>
        {limitLabel(sub.limits.projectLimit, 'live projects')}
        {' · '}
        {sub.limits.aiLimit === null
          ? 'Unlimited AI generations'
          : `${sub.aiGenerationsUsed} of ${sub.limits.aiLimit} AI generations used this period`}
      </p>
    </div>
  )
}
