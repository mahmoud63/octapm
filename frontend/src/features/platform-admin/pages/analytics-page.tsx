import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  platformAdminApi,
  type ModuleUsage,
} from '@/services/platform-admin/api'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
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
import { fmtDate, fmtDay, fmtNumber, fmtPercent, humanize } from '../lib/format'

const WINDOWS = [7, 30, 90] as const

function ModuleTable({ rows, empty }: { rows: ModuleUsage[]; empty: string }) {
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Module</TableHead>
            <TableHead className='text-right'>Events</TableHead>
            <TableHead className='text-right'>Companies</TableHead>
            <TableHead className='text-right'>People</TableHead>
            <TableHead className='text-right'>Of active companies</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className='py-6 text-center text-muted-foreground'
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.module}>
                <TableCell className='font-medium'>
                  {humanize(r.module)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {fmtNumber(r.events)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {fmtNumber(r.companies)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {fmtNumber(r.people)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {fmtPercent(r.shareOfActiveCompanies)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function PlatformAnalyticsPage() {
  const [windowDays, setWindowDays] = useState<number>(30)
  const query = useQuery({
    queryKey: ['platform-admin', 'analytics', windowDays],
    queryFn: () => platformAdminApi.analytics(windowDays),
    placeholderData: keepPreviousData,
  })
  const d = query.data

  return (
    <>
      <PageHeading
        title='Product Adoption'
        description='What people actually do in OctaPM: module usage, breadth across companies, repeat use and workflow completion. Usage is behaviour, not satisfaction — low usage is reported as low usage, nothing more.'
        actions={
          <div className='flex gap-1' role='group' aria-label='Window'>
            {WINDOWS.map((w) => (
              <Button
                key={w}
                size='sm'
                variant={w === windowDays ? 'default' : 'outline'}
                onClick={() => setWindowDays(w)}
              >
                {w} days
              </Button>
            ))}
          </div>
        }
      />
      {query.isLoading ? <LoadingBlock rows={8} /> : null}
      {query.error ? <ErrorBlock error={query.error} /> : null}
      {d ? (
        <div className='space-y-6'>
          {d.tracking.note ? (
            <Note tone='warning'>{d.tracking.note}</Note>
          ) : null}
          <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
            <KpiTile
              label='Daily active people'
              value={fmtNumber(d.engagement.dailyActivePeople)}
            />
            <KpiTile
              label='Weekly active'
              value={fmtNumber(d.engagement.weeklyActivePeople)}
            />
            <KpiTile
              label='Monthly active'
              value={fmtNumber(d.engagement.monthlyActivePeople)}
            />
            <KpiTile
              label={`Returning (${d.windowDays} d)`}
              value={fmtNumber(d.engagement.returningFromPreviousWindow)}
              hint={`of ${fmtNumber(d.engagement.activeInWindow)} active`}
            />
            <KpiTile
              label='Active companies'
              value={fmtNumber(d.denominators.activeCompanies)}
              hint={`of ${fmtNumber(d.denominators.eligibleCompanies)} eligible`}
            />
            <KpiTile
              label={`Tracked events (${d.windowDays} d)`}
              value={fmtNumber(d.tracking.trackedEventsInWindow)}
              hint={
                d.tracking.trackingSince
                  ? `since ${fmtDate(d.tracking.trackingSince)}`
                  : 'none yet'
              }
            />
          </div>

          <div className='grid gap-4 xl:grid-cols-2'>
            <Section
              title='Record activity by module'
              description={`Records created or changed in the last ${d.windowDays} days. Available for all history.`}
            >
              <div className='mb-4 h-64'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart
                    data={d.modules.recordActivity.slice(0, 12).map((r) => ({
                      module: humanize(r.module),
                      companies: r.companies,
                      people: r.people,
                    }))}
                    layout='vertical'
                    margin={{ left: 24 }}
                  >
                    <CartesianGrid strokeDasharray='3 3' horizontal={false} />
                    <XAxis
                      type='number'
                      allowDecimals={false}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type='category'
                      dataKey='module'
                      width={110}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip />
                    <Bar
                      isAnimationActive={false}
                      dataKey='companies'
                      name='Companies'
                      fill='#13c1ce'
                    />
                    <Bar
                      isAnimationActive={false}
                      dataKey='people'
                      name='People'
                      fill='#334155'
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ModuleTable
                rows={d.modules.recordActivity}
                empty='No record activity in this window.'
              />
            </Section>
            <Section
              title='Tracked usage by module'
              description='Screens opened, imports, exports and searches (from the release that added tracking onward).'
            >
              <ModuleTable
                rows={d.modules.trackedEvents}
                empty='No tracked events in this window yet.'
              />
              {d.events.length ? (
                <div className='mt-4 overflow-x-auto rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead className='text-right'>Events</TableHead>
                        <TableHead className='text-right'>Companies</TableHead>
                        <TableHead className='text-right'>People</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.events.map((e) => (
                        <TableRow key={`${e.eventName}-${e.platform}`}>
                          <TableCell className='font-mono text-xs'>
                            {e.eventName}
                          </TableCell>
                          <TableCell>{humanize(e.platform)}</TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {fmtNumber(e.events)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {fmtNumber(e.companies)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {fmtNumber(e.people)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </Section>
          </div>

          <div className='grid gap-4 xl:grid-cols-2'>
            <Section
              title='Active people per day'
              description={d.engagement.definitions.activePeople}
            >
              <div className='h-64'>
                <ResponsiveContainer width='100%' height='100%'>
                  <LineChart
                    data={d.engagement.daily.map((r) => ({
                      ...r,
                      day: fmtDay(r.day),
                    }))}
                  >
                    <CartesianGrid strokeDasharray='3 3' vertical={false} />
                    <XAxis dataKey='day' tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='people'
                      name='People'
                      stroke='#13c1ce'
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='companies'
                      name='Companies'
                      stroke='#334155'
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <Section
              title='Repeat use by module'
              description='People active in a module on two or more different days of the window.'
            >
              <div className='overflow-x-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      <TableHead className='text-right'>People</TableHead>
                      <TableHead className='text-right'>Came back</TableHead>
                      <TableHead className='text-right'>Repeat rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.repeatUse.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className='py-6 text-center text-muted-foreground'
                        >
                          No activity in this window.
                        </TableCell>
                      </TableRow>
                    ) : (
                      d.repeatUse.map((r) => (
                        <TableRow key={r.module}>
                          <TableCell className='font-medium'>
                            {humanize(r.module)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {fmtNumber(r.people)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {fmtNumber(r.repeat_people)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {fmtPercent(r.repeatRate)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Section>
          </div>

          <Section
            title='Workflow completion'
            description='Records created in the window, by how far they have got today. Built from the records’ own statuses.'
          >
            <div className='grid gap-6 lg:grid-cols-2'>
              {d.funnels.map((f) => (
                <div key={f.key}>
                  <div className='mb-2 text-sm font-medium'>{f.label}</div>
                  <div className='space-y-1.5'>
                    {f.steps.map((step) => (
                      <div
                        key={step.key}
                        className='flex items-center gap-3 text-sm'
                      >
                        <div className='w-56 shrink-0 text-muted-foreground'>
                          {step.label}
                        </div>
                        <div className='h-5 flex-1 rounded bg-muted'>
                          <div
                            className='h-5 rounded bg-[#13c1ce]'
                            style={{
                              width: `${Math.round((step.ofFirst ?? 0) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className='w-24 text-right tabular-nums'>
                          {fmtNumber(step.count)}{' '}
                          <span className='text-xs text-muted-foreground'>
                            {fmtPercent(step.ofFirst)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {f.rejected !== undefined ? (
                      <div className='text-xs text-muted-foreground'>
                        Rejected: {fmtNumber(f.rejected)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <div className='grid gap-4 lg:grid-cols-2'>
            <Section
              title='Last sign-in of active accounts'
              description={d.engagement.definitions.lastSignInDistribution}
            >
              <div className='h-56'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart
                    data={[
                      'last_24h',
                      'last_7d',
                      'last_30d',
                      'last_90d',
                      'older',
                      'never',
                    ].map((b) => ({
                      bucket: humanize(b),
                      people: d.engagement.lastSignInDistribution[b] ?? 0,
                    }))}
                  >
                    <CartesianGrid strokeDasharray='3 3' vertical={false} />
                    <XAxis dataKey='bucket' tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar
                      isAnimationActive={false}
                      dataKey='people'
                      name='People'
                      fill='#334155'
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <Section title='Sign-ups per day'>
              <div className='h-56'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart
                    data={d.engagement.signups.map((r) => ({
                      ...r,
                      day: fmtDay(r.day),
                    }))}
                  >
                    <CartesianGrid strokeDasharray='3 3' vertical={false} />
                    <XAxis dataKey='day' tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar
                      isAnimationActive={false}
                      dataKey='new_users'
                      name='New people'
                      fill='#13c1ce'
                    />
                    <Bar
                      isAnimationActive={false}
                      dataKey='new_companies'
                      name='New companies'
                      fill='#334155'
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>
          <Note>
            Adoption shares use real denominators:{' '}
            {d.denominators.definitions.activeCompanies} Feedback tools (helpful
            / not helpful, NPS, feature requests) are a later phase — until then
            this page reports behaviour only.
          </Note>
        </div>
      ) : null}
    </>
  )
}
