import { useQuery } from '@tanstack/react-query'
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
import { Badge } from '@/components/ui/badge'
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
  Section,
} from '../components/console-ui'
import {
  fmtBytes,
  fmtDateTime,
  fmtDay,
  fmtNumber,
  fmtRelative,
  humanize,
} from '../lib/format'

const Rows = ({
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
              className='py-5 text-center text-muted-foreground'
            >
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((cells, i) => (
            <TableRow key={i}>
              {cells.map((c, j) => (
                <TableCell key={j}>{c}</TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  </div>
)

const counts = (record: Record<string, number>) =>
  Object.keys(record).length ? (
    <div className='flex flex-wrap gap-2'>
      {Object.entries(record).map(([k, n]) => (
        <Badge key={k} variant='outline'>
          {humanize(k)}: {fmtNumber(n)}
        </Badge>
      ))}
    </div>
  ) : (
    <span className='text-sm text-muted-foreground'>None.</span>
  )

export function PlatformHealthPage() {
  const health = useQuery({
    queryKey: ['platform-admin', 'health'],
    queryFn: platformAdminApi.health,
    refetchInterval: 60_000,
  })
  const errors = useQuery({
    queryKey: ['platform-admin', 'errors'],
    queryFn: platformAdminApi.errors,
    refetchInterval: 60_000,
  })
  const h = health.data
  const e = errors.data

  return (
    <>
      <PageHeading
        title='System health'
        description='Operational signals from existing infrastructure: database, background jobs, scheduler, webhooks, notification delivery and API errors. No hostnames, connection strings or stack traces — find detail in the server log by request id.'
        actions={
          h ? (
            <span className='text-xs text-muted-foreground'>
              Refreshed {fmtDateTime(h.generatedAt)}
            </span>
          ) : null
        }
      />
      {health.isLoading ? <LoadingBlock rows={6} /> : null}
      {health.error ? <ErrorBlock error={health.error} /> : null}
      {h ? (
        <div className='space-y-6'>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
            <KpiTile
              label='Database'
              value={h.database.ok ? 'Up' : 'Down'}
              hint={`${h.database.latencyMs} ms · ${fmtNumber(h.database.connections)} connections`}
              tone={h.database.ok ? 'good' : 'danger'}
            />
            <KpiTile
              label='Database size (est.)'
              value={fmtBytes(h.database.sizeBytes)}
              hint={`${fmtNumber(h.database.queriesOver30s)} queries > 30 s`}
            />
            <KpiTile
              label='Queue ready'
              value={fmtNumber(h.jobs.queue.readyToRun)}
              hint={
                h.jobs.queue.oldestReadySince
                  ? `oldest ${fmtRelative(h.jobs.queue.oldestReadySince)}`
                  : 'nothing waiting'
              }
              tone={h.jobs.queue.readyToRun > 50 ? 'warning' : 'default'}
            />
            <KpiTile
              label='Stuck jobs'
              value={fmtNumber(h.jobs.queue.stuck)}
              hint={h.jobs.queue.stuckDefinition}
              tone={h.jobs.queue.stuck ? 'danger' : 'default'}
            />
            <KpiTile
              label='Scheduler leader'
              value={h.scheduler.leaderLockHeld ? 'Held' : 'None'}
              hint={
                h.scheduler.enabledInThisProcess
                  ? 'enabled here'
                  : 'disabled here'
              }
              tone={h.scheduler.leaderLockHeld ? 'good' : 'warning'}
            />
            <KpiTile
              label='Build'
              value={
                <span className='text-base'>
                  {h.release.sha?.slice(0, 7) ?? `v${h.release.version}`}
                </span>
              }
              hint={`${h.release.environment} · up ${Math.round(h.release.uptimeSeconds / 3600)} h · ${h.release.node}`}
            />
          </div>

          <div className='grid gap-4 lg:grid-cols-2'>
            <Section title='Background jobs (24 h)' description={h.worker.note}>
              {counts(h.jobs.last24HoursByStatus)}
              <div className='mt-2 text-xs text-muted-foreground'>
                Worker {h.worker.enabledInThisProcess ? 'enabled' : 'disabled'}{' '}
                in this process · last job activity{' '}
                {fmtRelative(h.worker.lastJobActivityAt)} · running{' '}
                {fmtNumber(h.jobs.queue.running)} · scheduled later{' '}
                {fmtNumber(h.jobs.queue.scheduledLater)}
              </div>
              <div className='mt-3'>
                <Rows
                  head={[
                    'Failed job',
                    'Company',
                    'Error code',
                    'Attempts',
                    'When',
                  ]}
                  empty='No failed jobs in 7 days.'
                  rows={h.jobs.recentFailures.map((j) => [
                    j.type,
                    j.organisation ? (
                      <Link
                        to='/platform-admin/companies/$orgId'
                        params={{ orgId: j.organisation.id }}
                        className='hover:underline'
                      >
                        {j.organisation.name}
                      </Link>
                    ) : (
                      '—'
                    ),
                    j.errorCode ?? '—',
                    `${j.attempts}/${j.maxAttempts}`,
                    fmtDateTime(j.failedAt),
                  ])}
                />
              </div>
            </Section>
            <Section title='Deliveries (7 days)'>
              <div className='space-y-3'>
                <div>
                  <div className='mb-1 text-sm font-medium'>Webhooks</div>
                  {counts(h.webhooks.last7DaysByStatus)}
                </div>
                <div>
                  <div className='mb-1 text-sm font-medium'>
                    Notifications (email, push, in-app)
                  </div>
                  <Rows
                    head={['Channel', 'Status', 'Count']}
                    empty='No deliveries.'
                    rows={h.notifications.last7Days.map((r) => [
                      humanize(r.channel),
                      humanize(r.status),
                      fmtNumber(r.n),
                    ])}
                  />
                </div>
                {h.notifications.failuresByCode.length ? (
                  <Rows
                    head={['Channel', 'Failure code', 'Count']}
                    empty=''
                    rows={h.notifications.failuresByCode.map((r) => [
                      humanize(r.channel),
                      r.code,
                      fmtNumber(r.n),
                    ])}
                  />
                ) : null}
              </div>
            </Section>
          </div>

          <Section title='API errors' description={e?.definitions.recorded}>
            {errors.error ? <ErrorBlock error={errors.error} /> : null}
            {e ? (
              <div className='space-y-4'>
                <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                  <KpiTile
                    label='Errors (24 h)'
                    value={fmtNumber(e.summary.last24Hours)}
                  />
                  <KpiTile
                    label='Server errors (24 h)'
                    value={fmtNumber(e.summary.serverErrorsLast24Hours)}
                    tone={
                      e.summary.serverErrorsLast24Hours ? 'danger' : 'default'
                    }
                  />
                  <KpiTile
                    label='Errors (7 d)'
                    value={fmtNumber(e.summary.last7Days)}
                  />
                  <KpiTile
                    label='Server errors (7 d)'
                    value={fmtNumber(e.summary.serverErrorsLast7Days)}
                    tone={
                      e.summary.serverErrorsLast7Days ? 'danger' : 'default'
                    }
                  />
                </div>
                {e.spikes.length ? (
                  <Note tone='warning'>
                    Spike days: {e.spikes.map(fmtDay).join(', ')}.{' '}
                    {e.definitions.spike}
                  </Note>
                ) : null}
                <div className='h-48'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart
                      data={e.daily.map((r) => ({
                        ...r,
                        day: fmtDay(r.day),
                        client: r.n - r.server,
                      }))}
                    >
                      <CartesianGrid strokeDasharray='3 3' vertical={false} />
                      <XAxis dataKey='day' tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar
                        isAnimationActive={false}
                        dataKey='client'
                        stackId='e'
                        name='4xx'
                        fill='#94a3b8'
                      />
                      <Bar
                        isAnimationActive={false}
                        dataKey='server'
                        stackId='e'
                        name='5xx'
                        fill='#dc2626'
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className='grid gap-4 lg:grid-cols-3'>
                  <Rows
                    head={['Code', 'Status', 'Count (7 d)']}
                    empty='None.'
                    rows={e.topCodes.map((r) => [
                      <span className='font-mono text-xs'>{r.code}</span>,
                      r.status,
                      fmtNumber(r.n),
                    ])}
                  />
                  <Rows
                    head={['Module', 'All', '5xx']}
                    empty='None.'
                    rows={e.byModule.map((r) => [
                      humanize(r.module),
                      fmtNumber(r.n),
                      fmtNumber(r.server),
                    ])}
                  />
                  <Rows
                    head={['Company', 'All', '5xx']}
                    empty='None.'
                    rows={e.byOrganisation.map((r) => [
                      <Link
                        to='/platform-admin/companies/$orgId'
                        params={{ orgId: r.organisation.id }}
                        className='hover:underline'
                      >
                        {r.organisation.name ?? r.organisation.id}
                      </Link>,
                      fmtNumber(r.n),
                      fmtNumber(r.server),
                    ])}
                  />
                </div>
                <Rows
                  head={['Method', 'Route (server errors, 7 d)', 'Count']}
                  empty='No server errors.'
                  rows={e.topServerErrorRoutes.map((r) => [
                    r.method,
                    <span className='font-mono text-xs'>{r.routePattern}</span>,
                    fmtNumber(r.n),
                  ])}
                />
              </div>
            ) : (
              <LoadingBlock rows={3} />
            )}
          </Section>

          <Section
            title='Telemetry pipeline'
            description='The writer behind product usage and error counts. Losses are counted, never hidden.'
          >
            <div className='flex flex-wrap gap-2 text-sm'>
              <Badge variant='outline'>
                {h.telemetry.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge variant='outline'>
                Usage rows written: {fmtNumber(h.telemetry.productWritten)}
              </Badge>
              <Badge variant='outline'>
                Error rows written: {fmtNumber(h.telemetry.errorWritten)}
              </Badge>
              <Badge variant='outline'>
                Buffered:{' '}
                {fmtNumber(
                  h.telemetry.buffered.product + h.telemetry.buffered.errors
                )}
              </Badge>
              <Badge variant={h.telemetry.dropped ? 'destructive' : 'outline'}>
                Dropped: {fmtNumber(h.telemetry.dropped)}
              </Badge>
              <Badge
                variant={h.telemetry.failedFlushes ? 'destructive' : 'outline'}
              >
                Failed writes: {fmtNumber(h.telemetry.failedFlushes)}
              </Badge>
            </div>
            <p className='mt-2 text-xs text-muted-foreground'>
              Counters are for this API process since it started (
              {Math.round(h.release.uptimeSeconds / 60)} min).
            </p>
          </Section>
          <Note>{h.scheduler.note}</Note>
        </div>
      ) : null}
    </>
  )
}
