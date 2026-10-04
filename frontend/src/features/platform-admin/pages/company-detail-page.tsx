import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { platformAdminApi } from '@/services/platform-admin/api'
import { ArrowLeft } from 'lucide-react'
import { roleLabel } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ErrorBlock,
  KpiTile,
  LoadingBlock,
  Note,
  PageHeading,
  Section,
  StatusBadge,
} from '../components/console-ui'
import {
  fmtBytes,
  fmtDate,
  fmtDateTime,
  fmtNumber,
  fmtRelative,
  humanize,
} from '../lib/format'

const SimpleTable = ({
  head,
  rows,
  empty,
}: {
  head: string[]
  rows: React.ReactNode[][]
  empty: string
}) => (
  <div className='overflow-x-auto rounded-md border'>
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={head.length}
              className='py-6 text-center text-muted-foreground'
            >
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((cells, i) => (
            <TableRow key={i}>
              {cells.map((cell, j) => (
                <TableCell key={j}>{cell}</TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  </div>
)

export function PlatformCompanyDetailPage() {
  const { orgId } = useParams({
    from: '/_platform/platform-admin/companies/$orgId',
  })
  const query = useQuery({
    queryKey: ['platform-admin', 'company', orgId],
    queryFn: () => platformAdminApi.company(orgId),
  })
  const d = query.data

  return (
    <>
      <Link
        to='/platform-admin/companies'
        className='mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'
      >
        <ArrowLeft className='size-4' /> Companies
      </Link>
      {query.isLoading ? <LoadingBlock rows={8} /> : null}
      {query.error ? <ErrorBlock error={query.error} /> : null}
      {d ? (
        <>
          <PageHeading
            title={d.company.name}
            description={`${humanize(d.company.workspaceType)} workspace · created ${fmtDate(d.company.createdAt)} · ${d.company.timezone ?? 'no timezone set'} · ${d.company.currency}`}
            actions={<StatusBadge value={d.company.status} />}
          />
          <Note>
            Platform metadata only: counts, statuses and names. Record content
            (RFI text, documents, messages, costs) is not shown here.
          </Note>
          <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
            <KpiTile
              label='Plan'
              value={
                <span className='text-lg'>
                  {d.subscription?.planName ??
                    humanize(d.subscription?.plan) ??
                    'None'}
                </span>
              }
              hint={
                d.subscription
                  ? humanize(d.subscription.status)
                  : 'no subscription'
              }
            />
            <KpiTile
              label='Active members'
              value={fmtNumber(d.members.byStatus.active ?? 0)}
              hint={`${fmtNumber(d.subscription?.seats)} seats`}
            />
            <KpiTile
              label='Admins / owners'
              value={`${d.members.activeAdmins} / ${d.members.activeOwners}`}
            />
            <KpiTile
              label='Projects'
              value={fmtNumber(
                d.projects.items.filter((p) => p.status !== 'archived').length
              )}
              hint={`${fmtNumber(d.projects.listed)} listed`}
            />
            <KpiTile
              label='Pending invitations'
              value={fmtNumber(d.members.pendingInvitations)}
            />
            <KpiTile
              label='Storage'
              value={fmtBytes(d.storage.bytes)}
              hint={`${fmtNumber(d.storage.files)} documents`}
            />
          </div>

          <Tabs defaultValue='users' className='mt-6'>
            <TabsList className='flex-wrap'>
              <TabsTrigger value='users'>Users</TabsTrigger>
              <TabsTrigger value='projects'>Projects</TabsTrigger>
              <TabsTrigger value='subscription'>Subscription</TabsTrigger>
              <TabsTrigger value='usage'>Product usage</TabsTrigger>
              <TabsTrigger value='errors'>Errors &amp; jobs</TabsTrigger>
              <TabsTrigger value='audit'>Audit summary</TabsTrigger>
            </TabsList>

            <TabsContent value='users' className='mt-4 space-y-3'>
              <div className='flex flex-wrap gap-2 text-xs'>
                {d.members.activeByRole.map((r) => (
                  <Badge key={r.role} variant='outline'>
                    {roleLabel(r.role)}: {r.n}
                  </Badge>
                ))}
                {Object.entries(d.members.byStatus).map(([s, n]) => (
                  <Badge key={s} variant='secondary'>
                    {humanize(s)}: {n}
                  </Badge>
                ))}
              </div>
              <SimpleTable
                head={[
                  'Name',
                  'Email',
                  'Role in this company',
                  'Membership',
                  'Account',
                  'Joined',
                  'Last sign-in',
                ]}
                empty='No members.'
                rows={d.members.items.map((m) => [
                  <span className='font-medium'>
                    {m.name}
                    {m.isOwner ? (
                      <Badge className='ml-2' variant='outline'>
                        Owner
                      </Badge>
                    ) : m.isAdmin ? (
                      <Badge className='ml-2' variant='outline'>
                        Admin
                      </Badge>
                    ) : null}
                  </span>,
                  m.email,
                  `${roleLabel(m.role)}${m.kind === 'guest' ? ' (guest)' : ''}`,
                  <StatusBadge value={m.membershipStatus} />,
                  <StatusBadge value={m.accountStatus} />,
                  fmtDate(m.joinedAt),
                  fmtRelative(m.lastLoginAt),
                ])}
              />
              {d.members.listed >= d.members.limit ? (
                <p className='text-xs text-muted-foreground'>
                  Showing the first {d.members.limit} members.
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value='projects' className='mt-4'>
              <SimpleTable
                head={[
                  'Project',
                  'Status',
                  'Created',
                  'Members',
                  'Last activity',
                  'Record changes (30 d)',
                ]}
                empty='No projects.'
                rows={d.projects.items.map((p) => [
                  <span className='font-medium'>{p.name}</span>,
                  <StatusBadge value={p.status} />,
                  fmtDate(p.createdAt),
                  fmtNumber(p.members),
                  fmtRelative(p.lastActivityAt),
                  fmtNumber(p.recordChanges30d),
                ])}
              />
            </TabsContent>

            <TabsContent value='subscription' className='mt-4'>
              {d.subscription ? (
                <Section
                  title='Subscription (read-only)'
                  description='From the billing service. Provider identifiers are never shown; linkage only.'
                >
                  <dl className='grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2'>
                    {[
                      [
                        'Plan',
                        `${d.subscription.planName ?? d.subscription.plan}${d.subscription.recognized ? '' : ' (not in the plan catalogue)'}`,
                      ],
                      ['Status', humanize(d.subscription.status)],
                      ['Has access', d.subscription.hasAccess ? 'Yes' : 'No'],
                      ['Seats', fmtNumber(d.subscription.seats)],
                      ['Billing cycle', humanize(d.subscription.billingCycle)],
                      [
                        'Trial',
                        `${fmtDate(d.subscription.trialStartsAt)} → ${fmtDate(d.subscription.trialEndsAt)}`,
                      ],
                      [
                        'Current period ends',
                        fmtDate(d.subscription.currentPeriodEnd),
                      ],
                      [
                        'Cancels at period end',
                        d.subscription.cancelAtPeriodEnd ? 'Yes' : 'No',
                      ],
                      ['Canceled at', fmtDate(d.subscription.canceledAt)],
                      [
                        'Payment provider linked',
                        d.subscription.providerCustomerLinked ? 'Yes' : 'No',
                      ],
                      [
                        'Last invoice',
                        humanize(d.subscription.lastInvoiceStatus),
                      ],
                      [
                        'Payment issue',
                        d.subscription.paymentIssue ? 'Yes' : 'No',
                      ],
                    ].map(([k, v]) => (
                      <div
                        key={k}
                        className='flex justify-between gap-4 border-b py-1.5'
                      >
                        <dt className='text-muted-foreground'>{k}</dt>
                        <dd className='font-medium'>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              ) : (
                <Note tone='warning'>
                  This organisation has no subscription row.
                </Note>
              )}
            </TabsContent>

            <TabsContent
              value='usage'
              className='mt-4 grid gap-4 lg:grid-cols-2'
            >
              <Section
                title='Record activity (30 days)'
                description='Changes to records, by module and action. Counts only.'
              >
                <SimpleTable
                  head={['Module', 'Action', 'Events', 'People']}
                  empty='No record activity in 30 days.'
                  rows={d.usage.recordActivity.map((r) => [
                    humanize(r.module),
                    humanize(r.action),
                    fmtNumber(r.events),
                    fmtNumber(r.people),
                  ])}
                />
              </Section>
              <Section
                title='Tracked product events (30 days)'
                description='Screens opened, imports, exports, searches.'
              >
                <SimpleTable
                  head={['Event', 'Events', 'People']}
                  empty='No tracked events yet for this company.'
                  rows={d.usage.trackedEvents.map((r) => [
                    r.eventName,
                    fmtNumber(r.events),
                    fmtNumber(r.people),
                  ])}
                />
              </Section>
            </TabsContent>

            <TabsContent
              value='errors'
              className='mt-4 grid gap-4 lg:grid-cols-2'
            >
              <Section title='API errors (30 days)'>
                <SimpleTable
                  head={['Code', 'Status', 'Count']}
                  empty='No errors recorded.'
                  rows={d.errors.byCode.map((e) => [
                    e.code,
                    e.status,
                    fmtNumber(e.n),
                  ])}
                />
              </Section>
              <Section title='Background jobs (30 days)'>
                <div className='mb-3 flex flex-wrap gap-2'>
                  {Object.entries(d.jobs.byStatus).map(([s, n]) => (
                    <Badge key={s} variant='outline'>
                      {humanize(s)}: {n}
                    </Badge>
                  ))}
                  {Object.keys(d.jobs.byStatus).length === 0 ? (
                    <span className='text-sm text-muted-foreground'>
                      No jobs.
                    </span>
                  ) : null}
                </div>
                <SimpleTable
                  head={['Failed job', 'Error code', 'Attempts', 'When']}
                  empty='No failed jobs.'
                  rows={d.jobs.recentFailures.map((j) => [
                    j.type,
                    j.errorCode ?? '—',
                    `${j.attempts}/${j.maxAttempts}`,
                    fmtDateTime(j.updatedAt),
                  ])}
                />
              </Section>
            </TabsContent>

            <TabsContent value='audit' className='mt-4'>
              <Section
                title='Recent platform views of this company'
                description='Who on the OctaPM platform team looked at this company.'
              >
                <SimpleTable
                  head={['When', 'Operator', 'Action', 'Status']}
                  empty='No platform views recorded.'
                  rows={d.platformAccess.recentViews.map((v) => [
                    fmtDateTime(v.occurredAt),
                    v.actorEmail,
                    v.action,
                    v.statusCode || 'in progress',
                  ])}
                />
              </Section>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </>
  )
}
