import { useQuery } from '@tanstack/react-query'
import type { OverviewAdditions } from '@/services/platform-admin/integration-api'
import { Link } from '@tanstack/react-router'
import { platformAdminApi } from '@/services/platform-admin/api'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ErrorBlock,
  KpiTile,
  LoadingBlock,
  Note,
  PageHeading,
  Section,
} from '../components/console-ui'
import { fmtBytes, fmtDateTime, fmtNumber, humanize } from '../lib/format'

export function PlatformOverviewPage() {
  const query = useQuery({
    queryKey: ['platform-admin', 'overview'],
    queryFn: platformAdminApi.overview,
  })
  const d = query.data

  return (
    <>
      <PageHeading
        title='Platform overview'
        description='Every figure is counted from canonical records at request time. Nothing on this console changes customer data.'
        actions={
          d ? (
            <span className='text-xs text-muted-foreground'>
              As of {fmtDateTime(d.generatedAt)}
            </span>
          ) : null
        }
      />
      {query.isLoading ? <LoadingBlock rows={6} /> : null}
      {query.error ? <ErrorBlock error={query.error} /> : null}
      {d ? (
        <div className='space-y-6'>
          {(d as typeof d & OverviewAdditions).ai ? (
            <div className='grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6' data-testid='platform-overview-ai'>
              <KpiTile label='AI requests today' value={fmtNumber((d as typeof d & OverviewAdditions).ai!.today.requests)} hint={`${fmtNumber((d as typeof d & OverviewAdditions).ai!.last7Days.requests)} in 7 days`} />
              <KpiTile label='AI tokens today' value={fmtNumber((d as typeof d & OverviewAdditions).ai!.today.totalTokens)} hint={`${(d as typeof d & OverviewAdditions).ai!.provider || 'no provider'} · ${(d as typeof d & OverviewAdditions).ai!.model || '—'}`} />
              <KpiTile label='AI failed today' value={fmtNumber((d as typeof d & OverviewAdditions).ai!.today.failed)} tone={(d as typeof d & OverviewAdditions).ai!.today.failed ? 'warning' : 'default'} hint={`${fmtNumber((d as typeof d & OverviewAdditions).ai!.today.blocked)} blocked by limits`} />
              <KpiTile label='BIM / 5D projects' value={fmtNumber((d as typeof d & OverviewAdditions).features?.bim.projects)} hint={`${fmtNumber((d as typeof d & OverviewAdditions).features?.bim.models)} models`} />
              <KpiTile label='Closeout projects' value={fmtNumber((d as typeof d & OverviewAdditions).features?.closeout.projects)} hint={`${fmtNumber((d as typeof d & OverviewAdditions).features?.closeout.deliverables)} deliverables`} />
              <KpiTile label='Consultant reviews open' value={fmtNumber((d as typeof d & OverviewAdditions).features?.consultantReviews.awaitingConsultant)} tone={(d as typeof d & OverviewAdditions).features?.consultantReviews.overdue ? 'warning' : 'default'} hint={`${fmtNumber((d as typeof d & OverviewAdditions).features?.consultantReviews.overdue)} overdue · ${fmtNumber((d as typeof d & OverviewAdditions).features?.consultantReviews.projectsWithConsultants)} projects with consultants`} />
            </div>
          ) : null}
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
            <KpiTile
              label='Organisations'
              value={fmtNumber(d.organisations.total)}
              hint={`${fmtNumber(d.organisations.company)} company · ${fmtNumber(d.organisations.personal)} personal`}
            />
            <KpiTile
              label='Active (30 days)'
              value={fmtNumber(d.organisations.activeLast30Days)}
              hint='companies with activity'
              tone='good'
            />
            <KpiTile
              label='New this month'
              value={fmtNumber(d.organisations.newThisMonth)}
              hint={`${fmtNumber(d.users.newThisMonth)} new users`}
            />
            <KpiTile
              label='Suspended / closed'
              value={fmtNumber(d.organisations.suspendedOrClosed)}
              tone={d.organisations.suspendedOrClosed ? 'warning' : 'default'}
            />
            <KpiTile
              label='Users'
              value={fmtNumber(d.users.total)}
              hint={`${fmtNumber(d.users.activeStatus)} active accounts`}
            />
            <KpiTile
              label='Active users'
              value={fmtNumber(d.users.activeLast30Days)}
              hint={`${fmtNumber(d.users.activeLast24Hours)} in the last 24 h`}
              tone='good'
            />
            <KpiTile
              label='Active projects'
              value={fmtNumber(d.projects.active)}
              hint={`${fmtNumber(d.projects.archived)} archived`}
            />
            <KpiTile label='Trial' value={fmtNumber(d.subscriptions.trial)} />
            <KpiTile
              label='Business'
              value={fmtNumber(d.subscriptions.business)}
            />
            <KpiTile
              label='Enterprise'
              value={fmtNumber(d.subscriptions.enterprise)}
            />
            <KpiTile
              label='Past due'
              value={fmtNumber(d.subscriptions.pastDue)}
              tone={d.subscriptions.pastDue ? 'danger' : 'default'}
            />
            <KpiTile
              label='Canceled / expired'
              value={fmtNumber(d.subscriptions.canceledOrExpired)}
            />
            <KpiTile
              label='Pending invitations'
              value={fmtNumber(d.invitations.pending)}
            />
            <KpiTile
              label='Stored files'
              value={fmtBytes(d.storage.bytes)}
              hint={`${fmtNumber(d.storage.files)} documents`}
            />
            <KpiTile
              label='Failed jobs (24 h)'
              value={fmtNumber(d.jobs.failedLast24Hours)}
              hint={`${fmtNumber(d.jobs.failedLast7Days)} in 7 days`}
              tone={d.jobs.failedLast24Hours ? 'danger' : 'default'}
            />
            <KpiTile
              label='API errors (24 h)'
              value={fmtNumber(d.errors.last24Hours)}
              hint={`${fmtNumber(d.errors.serverErrorsLast24Hours)} server errors`}
              tone={d.errors.serverErrorsLast24Hours ? 'danger' : 'default'}
            />
            <KpiTile
              label='No subscription'
              value={fmtNumber(d.organisations.withoutSubscription)}
            />
            <KpiTile
              label='Build'
              value={
                <span className='text-base'>
                  {d.release.sha?.slice(0, 7) ?? `v${d.release.version}`}
                </span>
              }
              hint={d.release.environment}
            />
          </div>

          <div className='grid gap-4 lg:grid-cols-2'>
            <Section title='Subscriptions by status'>
              <div className='h-56'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart
                    data={Object.entries(d.subscriptions.byStatus).map(
                      ([status, n]) => ({ status: humanize(status), n })
                    )}
                  >
                    <CartesianGrid strokeDasharray='3 3' vertical={false} />
                    <XAxis dataKey='status' tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar
                      isAnimationActive={false}
                      dataKey='n'
                      name='Organisations'
                      fill='#13c1ce'
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <Section title='Subscriptions by plan'>
              <div className='h-56'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart
                    data={Object.entries(d.subscriptions.byPlan).map(
                      ([plan, n]) => ({ plan: humanize(plan), n })
                    )}
                  >
                    <CartesianGrid strokeDasharray='3 3' vertical={false} />
                    <XAxis dataKey='plan' tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar
                      isAnimationActive={false}
                      dataKey='n'
                      name='Organisations'
                      fill='#334155'
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>
          <Note>
            {d.definitions.activeLast30Days} See{' '}
            <Link className='underline' to='/platform-admin/analytics'>
              Product Adoption
            </Link>{' '}
            for module usage and{' '}
            <Link className='underline' to='/platform-admin/health'>
              System Health
            </Link>{' '}
            for jobs and errors.
          </Note>
        </div>
      ) : null}
    </>
  )
}
