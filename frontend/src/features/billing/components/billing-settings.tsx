import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
          <div className='text-lg font-semibold'>
            {sub.planName}{sub.billingCycle ? ` · ${sub.billingCycle}` : ''}
          </div>
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
        planName={sub.planName}
        periodEnd={sub.currentPeriodEnd}
      />
    </div>
  )
}
