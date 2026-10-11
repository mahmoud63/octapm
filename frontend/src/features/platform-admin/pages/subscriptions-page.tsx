import { useCallback } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { platformAdminApi } from '@/services/platform-admin/api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ErrorBlock,
  KpiTile,
  LoadingBlock,
  Note,
  PageHeading,
  Pager,
  StatusBadge,
} from '../components/console-ui'
import { FilterSelect, SearchBox } from '../components/list-filters'
import { fmtDate, fmtNumber, humanize } from '../lib/format'
import { useListState } from '../lib/use-list-state'

export function PlatformSubscriptionsPage() {
  const { filters, set, page, setPage } = useListState({
    q: '',
    plan: '',
    status: '',
    paymentIssue: '',
    trialEndingDays: '',
    sort: 'company',
  })
  const query = useQuery({
    queryKey: ['platform-admin', 'subscriptions', filters, page],
    queryFn: () =>
      platformAdminApi.subscriptions({ ...filters, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })
  const onSearch = useCallback((v: string) => set('q')(v), [set])
  const s = query.data?.summary

  return (
    <>
      <PageHeading
        title='Subscriptions'
        description='Read-only view of the billing service. This console cannot charge, refund or change a plan; provider identifiers and secrets are never shown.'
      />
      {s ? (
        <div className='mb-4 grid grid-cols-2 gap-3 md:grid-cols-5'>
          <KpiTile label='Subscriptions' value={fmtNumber(s.total)} />
          <KpiTile
            label='Trials ending ≤ 7 days'
            value={fmtNumber(s.trialsEndingIn7Days)}
            tone={s.trialsEndingIn7Days ? 'warning' : 'default'}
          />
          <KpiTile
            label='Past due'
            value={fmtNumber(s.pastDue)}
            tone={s.pastDue ? 'danger' : 'default'}
          />
          <KpiTile
            label='Cancel at period end'
            value={fmtNumber(s.cancelAtPeriodEnd)}
          />
          <KpiTile
            label='Unknown plan'
            value={fmtNumber(s.unrecognizedPlan)}
            tone={s.unrecognizedPlan ? 'warning' : 'default'}
          />
        </div>
      ) : null}
      <div className='mb-4 flex flex-wrap gap-2'>
        <SearchBox
          value={filters.q}
          onChange={onSearch}
          placeholder='Search company'
        />
        <FilterSelect
          label='Plan'
          value={filters.plan}
          onChange={set('plan')}
          options={[
            'trial',
            'individual',
            'business',
            'enterprise',
            'standard',
          ].map((v) => ({ value: v, label: humanize(v) }))}
        />
        <FilterSelect
          label='Status'
          value={filters.status}
          onChange={set('status')}
          options={[
            'trialing',
            'active',
            'past_due',
            'canceled',
            'expired',
            'incomplete',
          ].map((v) => ({ value: v, label: humanize(v) }))}
        />
        <FilterSelect
          label='Payment issue'
          value={filters.paymentIssue}
          onChange={set('paymentIssue')}
          options={[{ value: 'true', label: 'Only payment issues' }]}
        />
        <FilterSelect
          label='Trial ending'
          value={filters.trialEndingDays}
          onChange={set('trialEndingDays')}
          options={[
            { value: '7', label: 'Within 7 days' },
            { value: '30', label: 'Within 30 days' },
          ]}
        />
      </div>
      {query.isLoading ? <LoadingBlock /> : null}
      {query.error ? <ErrorBlock error={query.error} /> : null}
      {query.data ? (
        <>
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Seats used</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Trial ends</TableHead>
                  <TableHead>Period ends</TableHead>
                  <TableHead>Cancellation</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className='py-8 text-center text-muted-foreground'
                    >
                      No subscriptions match.
                    </TableCell>
                  </TableRow>
                ) : null}
                {query.data.items.map((r) => (
                  <TableRow key={r.organisation.id}>
                    <TableCell>
                      <Link
                        to='/platform-admin/companies/$orgId'
                        params={{ orgId: r.organisation.id }}
                        className='font-medium hover:underline'
                      >
                        {r.organisation.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.planName ?? humanize(r.plan)}
                      {!r.recognized ? (
                        <span className='ml-1 text-xs text-amber-600'>
                          (not in catalogue)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={r.status} />
                      {!r.hasAccess ? (
                        <div className='text-xs text-red-600'>no access</div>
                      ) : null}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {fmtNumber(r.activeMembers)} / {fmtNumber(r.seats)}
                    </TableCell>
                    <TableCell>{humanize(r.billingCycle)}</TableCell>
                    <TableCell>{fmtDate(r.trialEndsAt)}</TableCell>
                    <TableCell>{fmtDate(r.currentPeriodEnd)}</TableCell>
                    <TableCell>
                      {r.cancelAtPeriodEnd
                        ? 'At period end'
                        : r.canceledAt
                          ? `Canceled ${fmtDate(r.canceledAt)}`
                          : '—'}
                    </TableCell>
                    <TableCell className='text-xs'>
                      {r.providerSubscriptionLinked
                        ? 'Linked'
                        : r.providerCustomerLinked
                          ? 'Customer only'
                          : 'Not linked'}
                    </TableCell>
                    <TableCell>
                      {r.paymentIssue ? (
                        <StatusBadge value='past_due' />
                      ) : (
                        <span className='text-xs text-muted-foreground'>
                          {humanize(r.lastInvoiceStatus) || '—'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={query.data.page} onPage={setPage} />
          <div className='mt-3'>
            <Note>
              Plan changes, refunds and charges are not available here by design
              (V1 is read-only). Billing lifecycle actions need a separate,
              audited workflow.
            </Note>
          </div>
        </>
      ) : null}
    </>
  )
}
