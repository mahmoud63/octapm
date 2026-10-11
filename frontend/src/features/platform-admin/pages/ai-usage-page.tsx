import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { type AiTotals, platformIntegrationApi } from '@/services/platform-admin/integration-api'
import { ErrorBlock, KpiTile, LoadingBlock, Note, PageHeading, Section } from '../components/console-ui'
import { fmtDateTime, fmtNumber } from '../lib/format'

const WINDOWS = [1, 7, 30, 90] as const
const ms = (value: number | null) => (value === null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`)
const usd = (micros: number | null) => (micros === null ? '—' : `$${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 4 : 2)}`)
const cost = (row: AiTotals) => (row.unpricedRequests && !row.estimatedCostMicros ? 'no price configured' : `${usd(row.estimatedCostMicros)}${row.unpricedRequests ? ` + ${fmtNumber(row.unpricedRequests)} unpriced` : ''}`)

function Table({ head, rows }: { head: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (!rows.length) return <p className='text-sm text-muted-foreground'>No AI calls in this window.</p>
  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-sm tabular-nums'>
        <thead className='text-xs text-muted-foreground'>
          <tr>{head.map((h) => <th key={h} className='px-2 py-1.5 text-left font-medium whitespace-nowrap'>{h}</th>)}</tr>
        </thead>
        <tbody>{rows.map((row, i) => <tr key={i} className='border-t'>{row.map((cell, j) => <td key={j} className='px-2 py-1.5 whitespace-nowrap'>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/**
 * AI usage from the AI gateway's ledger (AiRun): requests, tokens, latency,
 * failures by model, feature, company and person. No prompt or answer is
 * stored or shown. Cost is an estimate from the configured price table only.
 */
export function PlatformAiUsagePage({ orgId = null }: { orgId?: string | null }) {
  const [days, setDays] = useState<number>(7)
  const query = useQuery({ queryKey: ['platform-admin', 'ai-usage', days, orgId], queryFn: () => platformIntegrationApi.aiUsage(days, orgId) })
  const d = query.data
  return (
    <>
      <PageHeading
        title='AI usage'
        description='From the AI gateway ledger: one record per model call — who, which feature, which model, tokens, latency, outcome. Never the prompt or the answer.'
        actions={
          <div className='flex items-center gap-1' role='group' aria-label='Window'>
            {WINDOWS.map((w) => (
              <button key={w} type='button' onClick={() => setDays(w)} className={`rounded-md border px-2.5 py-1 text-xs ${days === w ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                {w === 1 ? '24 h' : `${w} days`}
              </button>
            ))}
          </div>
        }
      />
      {query.isLoading ? <LoadingBlock rows={6} /> : null}
      {query.error ? <ErrorBlock error={query.error} /> : null}
      {d ? (
        <div className='space-y-6' data-testid='platform-ai-usage'>
          <Note>
            Provider <strong>{d.configuration.provider || 'none'}</strong> ({d.configuration.mode}) · main model <strong>{d.configuration.model || '—'}</strong>
            {d.configuration.fastModel ? <> · fast model <strong>{d.configuration.fastModel}</strong></> : null}. Limits per UTC day: organisation{' '}
            {fmtNumber(d.configuration.limits.dailyTokensPerOrganisation)} tokens, person {fmtNumber(d.configuration.limits.dailyTokensPerUser)} tokens /{' '}
            {fmtNumber(d.configuration.limits.dailyRequestsPerUser)} requests. Read-only here: limits are set on the API, and this console has no switch that lifts them.
          </Note>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
            <KpiTile label='Requests today' value={fmtNumber(d.today.requests)} hint={`${fmtNumber(d.today.failed)} failed · ${fmtNumber(d.today.blocked)} blocked`} />
            <KpiTile label='Tokens today' value={fmtNumber(d.today.totalTokens)} hint={`${fmtNumber(d.today.inputTokens)} in · ${fmtNumber(d.today.outputTokens)} out`} />
            <KpiTile label={`Requests (${days === 1 ? '24 h' : `${days} d`})`} value={fmtNumber(d.window.requests)} hint={`${fmtNumber(d.window.ok)} ok`} />
            <KpiTile label={`Tokens (${days === 1 ? '24 h' : `${days} d`})`} value={fmtNumber(d.window.totalTokens)} hint={`${fmtNumber(d.window.inputTokens)} in · ${fmtNumber(d.window.outputTokens)} out`} />
            <KpiTile label='Latency (ok calls)' value={ms(d.window.avgLatencyMs)} hint={`p95 ${ms(d.window.p95LatencyMs)}`} />
            <KpiTile label='Failed / blocked' value={`${fmtNumber(d.window.failed)} / ${fmtNumber(d.window.blocked)}`} tone={d.window.failed ? 'warning' : 'default'} hint={`estimated cost ${cost(d.window)}`} />
          </div>
          <Section title='Requests per day'>
            <div className='h-48'>
              <ResponsiveContainer width='100%' height='100%'>
                <BarChart data={d.daily.map((row) => ({ ...row, requests: Number(row.requests), day: String(row.day).slice(0, 10) }))}>
                  <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
                  <XAxis dataKey='day' fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Bar isAnimationActive={false} dataKey='requests' name='Requests' fill='#13c1ce' radius={[3, 3, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
          <div className='grid gap-6 xl:grid-cols-2'>
            <Section title='By model'>
              <Table head={['Provider', 'Model', 'Requests', 'Tokens', 'Avg latency', 'Failed', 'Estimated cost']} rows={d.byModel.map((r) => [r.provider, r.model, fmtNumber(r.requests), fmtNumber(r.totalTokens), ms(r.avgLatencyMs), fmtNumber(r.failed), cost(r)])} />
            </Section>
            <Section title='By module / feature'>
              <Table head={['Module', 'Feature', 'Requests', 'Tokens', 'Failed']} rows={d.byFeature.map((r) => [r.module, r.feature, fmtNumber(r.requests), fmtNumber(r.totalTokens), fmtNumber(r.failed)])} />
            </Section>
          </div>
          {!orgId ? (
            <Section title='By company' description='Today’s tokens against the configured daily organisation limit.'>
              <Table
                head={['Company', 'Requests', 'Tokens', 'People', 'Projects', 'Failed', 'Today', 'Of daily limit']}
                rows={d.byOrganisation.map((r) => [
                  r.organisation ? <Link key={r.organisation.id} to='/platform-admin/companies/$orgId' params={{ orgId: r.organisation.id }} className='text-primary hover:underline'>{r.organisation.name}</Link> : '—',
                  fmtNumber(r.requests), fmtNumber(r.totalTokens), fmtNumber(r.people), fmtNumber(r.projects), fmtNumber(r.failed), `${fmtNumber(r.today.tokens)} tokens`,
                  r.todayShareOfLimit === null ? '—' : <span className={r.todayShareOfLimit >= 80 ? 'font-semibold text-amber-600' : undefined}>{r.todayShareOfLimit}%</span>,
                ])}
              />
            </Section>
          ) : null}
          <div className='grid gap-6 xl:grid-cols-2'>
            <Section title='By person'>
              <Table head={['Person', 'Company', 'Requests', 'Tokens', 'Failed']} rows={d.byUser.map((r) => [r.user.name || r.user.email || '—', r.organisation?.name || '—', fmtNumber(r.requests), fmtNumber(r.totalTokens), fmtNumber(r.failed)])} />
            </Section>
            <Section title='Calls that did not succeed'>
              <Table head={['Outcome', 'Error class', 'Calls']} rows={d.failures.map((r) => [r.status, r.errorClass, fmtNumber(r.count)])} />
            </Section>
          </div>
          <p className='text-xs text-muted-foreground'>{d.definitions.estimatedCost} {d.definitions.blocked} As of {fmtDateTime(d.generatedAt)}.</p>
        </div>
      ) : null}
    </>
  )
}
