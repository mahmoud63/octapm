import type { CompanyAdditions } from '@/services/platform-admin/integration-api'
import { KpiTile, Note, Section } from './console-ui'
import { NewFeatureTiles } from './feature-adoption'
import { fmtNumber } from '../lib/format'

const LABELS: Record<string, string> = {
  schedule: 'Schedule', progress: 'Progress', boq: 'BOQ', cost: 'Cost', commercial: 'Commercial', procurement: 'Procurement', quality: 'Quality',
  rfi: 'RFIs', submittals: 'Submittals', reports: 'Reports', documents: 'Documents', bim: 'BIM / 5D', closeout: 'Closeout', consultant_reviews: 'Consultant Reviews', ai: 'AI',
}

/** One company's AI consumption (gateway ledger, 30 days) and which capabilities its projects use — counts only. */
export function CompanyAiAndAdoption({ detail }: { orgId: string; detail: CompanyAdditions }) {
  const ai = detail.ai
  const features = detail.features
  return (
    <div className='space-y-4' data-testid='platform-company-ai-adoption'>
      {ai ? (
        <Section title='AI usage (30 days)' description='From the AI gateway ledger: requests, tokens and outcomes. Never the prompt or the answer.'>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            <KpiTile label='Requests today' value={fmtNumber(ai.today.requests)} hint={`${fmtNumber(ai.window.requests)} in 30 days`} />
            <KpiTile label='Tokens today' value={fmtNumber(ai.today.totalTokens)} hint={ai.todayShareOfLimit === null ? 'no organisation limit' : `${ai.todayShareOfLimit}% of the daily organisation limit`} tone={(ai.todayShareOfLimit || 0) >= 80 ? 'warning' : 'default'} />
            <KpiTile label='Tokens (30 days)' value={fmtNumber(ai.window.totalTokens)} hint={`${fmtNumber(ai.window.inputTokens)} in · ${fmtNumber(ai.window.outputTokens)} out`} />
            <KpiTile label='Failed / blocked' value={`${fmtNumber(ai.window.failed)} / ${fmtNumber(ai.window.blocked)}`} tone={ai.window.failed ? 'warning' : 'default'} />
          </div>
          <div className='mt-4 grid gap-4 lg:grid-cols-2'>
            <div>
              <p className='mb-1 text-xs font-semibold text-muted-foreground uppercase'>By feature</p>
              <ul className='space-y-0.5 text-sm'>{ai.byFeature.map((row) => <li key={row.feature} className='flex justify-between gap-2'><span>{row.feature}</span><span className='tabular-nums'>{fmtNumber(row.requests)} · {fmtNumber(row.totalTokens)} tokens</span></li>)}</ul>
            </div>
            <div>
              <p className='mb-1 text-xs font-semibold text-muted-foreground uppercase'>By model</p>
              <ul className='space-y-0.5 text-sm'>{ai.byModel.map((row) => <li key={`${row.provider}-${row.model}`} className='flex justify-between gap-2'><span>{row.model}</span><span className='tabular-nums'>{fmtNumber(row.requests)}</span></li>)}</ul>
            </div>
          </div>
          <p className='mt-3 text-xs text-muted-foreground'>Limits are configured on the API ({fmtNumber(ai.configuration.limits.dailyTokensPerOrganisation)} tokens per organisation per UTC day); this console cannot lift them.</p>
        </Section>
      ) : null}
      {features ? (
        <>
          <Section title='Capabilities in use' description={`Projects (of ${fmtNumber(features.projects)} open) holding records each capability creates.`}>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8'>
              {Object.entries(LABELS).map(([key, label]) => (
                <div key={key} className='rounded-md border px-2 py-1.5'>
                  <p className='text-[11px] text-muted-foreground'>{label}</p>
                  <p className={features.capabilities[key] ? 'font-semibold tabular-nums' : 'text-muted-foreground tabular-nums'}>{fmtNumber(features.capabilities[key] || 0)}</p>
                </div>
              ))}
              <div className='rounded-md border px-2 py-1.5'><p className='text-[11px] text-muted-foreground'>Inventory items</p><p className='font-semibold tabular-nums'>{fmtNumber(features.inventoryItems)}</p></div>
            </div>
          </Section>
          <NewFeatureTiles detail={features.detail} />
        </>
      ) : <Note>No adoption data.</Note>}
    </div>
  )
}
