import { Bot } from 'lucide-react'
import { Note, PageHeading, Section } from '../components/console-ui'

const PLANNED = [
  ['AI requests', 'Count per feature, model and day'],
  [
    'Organisations / people using AI',
    'Distinct companies and people per feature',
  ],
  ['Feature', 'Schedule generation, assistant, drafting, extraction …'],
  ['Model', 'Provider and model id per request'],
  ['Input / output tokens', 'Per request, summed per company and feature'],
  ['Cost', 'From tokens × the provider price table in force on the day'],
  ['Latency', 'p50 / p95 per feature and model'],
  [
    'Success / failure',
    'Outcome and error code (never the prompt or the answer)',
  ],
  ['User feedback', 'Helpful / not helpful on AI answers'],
]

/**
 * Placeholder only. The AI provider is not activated in this release and
 * nothing here reads or invents AI usage figures.
 */
export function PlatformAiUsagePage() {
  return (
    <>
      <PageHeading
        title='AI usage'
        description='Planned. The AI provider is not active in this release, so there is nothing to measure yet.'
      />
      <Note tone='warning'>
        No AI usage data is shown — none exists, and this console never displays
        placeholder numbers.
      </Note>
      <Section
        className='mt-4'
        title='What this page will report'
        description='Each figure will come from one AI-request record written by the AI service layer, holding identifiers, counts and outcomes only — no prompts, no answers, no customer content.'
      >
        <div className='flex items-start gap-4'>
          <Bot
            className='mt-1 size-8 shrink-0 text-muted-foreground'
            aria-hidden
          />
          <dl className='grid flex-1 gap-2 text-sm sm:grid-cols-2'>
            {PLANNED.map(([k, v]) => (
              <div key={k} className='rounded-md border px-3 py-2'>
                <dt className='font-medium'>{k}</dt>
                <dd className='text-muted-foreground'>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>
    </>
  )
}
