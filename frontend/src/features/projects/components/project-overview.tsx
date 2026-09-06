import { formatShortDate } from '@/lib/dates'
import type { Project, ProjectParty } from '../data/schema'

// Contract dates are stored as UTC midnight; local formatting showed them a
// day early. See lib/dates.ts.
const formatDate = (value: string | null) => formatShortDate(value)

function formatMoney(currency: string, value: number | null | undefined) {
  if (value == null) return '—'
  return `${currency} ${Number(value).toLocaleString()}`
}

function formatDuration(
  duration: number | null | undefined,
  durationUnit: string | null | undefined
) {
  if (!duration) return '—'
  return `${duration} ${durationUnit || 'months'}`
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return '-'
  return `${Number(value).toLocaleString()}%`
}

function formatNumber(value: number | null | undefined, suffix = '') {
  if (value == null) return '-'
  return `${Number(value).toLocaleString()}${suffix}`
}

const contractTypeLabels: Record<string, string> = {
  lump_sum: 'Lump Sum',
  unit_rate: 'Unit Rate',
  remeasurement: 'Remeasurement',
  cost_plus: 'Cost Plus',
  design_build: 'Design-Build',
  epc: 'EPC',
  other: 'Other',
}

const projectCalendarLabels: Record<string, string> = {
  five_day: '5-Day',
  six_day: '6-Day',
  seven_day: '7-Day',
  custom: 'Custom',
}

function formatLabel(
  labels: Record<string, string>,
  value: string | null | undefined
) {
  if (!value) return '-'
  return labels[value] ?? value
}

function DetailItem({
  label,
  value,
}: {
  label: string
  value: string | number | null | undefined
}) {
  return (
    <div>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-1 text-sm font-medium text-foreground'>{value ?? '-'}</p>
    </div>
  )
}

function PartyDetailItem({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-1 text-sm font-medium text-foreground'>{value || '-'}</p>
    </div>
  )
}

/** Project basics, parties, contract terms and defaults (the Overview module). */
export function ProjectOverview({
  project,
  parties,
}: {
  project: Project
  parties: ProjectParty[]
}) {
  return (
    <div className='space-y-4'>
      <section className='rounded-md border p-4'>
        <h3 className='mb-3 text-sm font-semibold'>Project Basics</h3>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          <DetailItem label='Type' value={project.type ?? '-'} />
          <DetailItem label='Location' value={project.location ?? '-'} />
          <DetailItem
            label='Duration'
            value={formatDuration(project.duration, project.durationUnit)}
          />
          <DetailItem
            label='Start Date'
            value={formatDate(project.startDate)}
          />
          <DetailItem label='End Date' value={formatDate(project.endDate)} />
          <DetailItem
            label='Baseline Date'
            value={formatDate(project.baselineDate ?? null)}
          />
          <DetailItem
            label='Data Date'
            value={formatDate(project.dataDate ?? null)}
          />
        </div>
      </section>

      <section className='rounded-md border p-4'>
        <h3 className='mb-3 text-sm font-semibold'>Contract Parties</h3>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <PartyDetailItem
            label='Client / Owner'
            value={
              parties.find((party) => party.role === 'owner')?.company?.name ??
              project.clientName
            }
          />
          <PartyDetailItem
            label='Consultant'
            value={
              parties.find((party) => party.role === 'consultant')?.company
                ?.name ?? project.consultantName
            }
          />
          <PartyDetailItem
            label='Contractor'
            value={
              parties.find((party) => party.role === 'contractor')?.company
                ?.name ?? project.contractorName
            }
          />
          <PartyDetailItem
            label='Subcontractors'
            value={
              parties
                .filter((party) => party.role === 'subcontractor')
                .map((party) => party.company?.name)
                .filter(Boolean)
                .join(', ') || null
            }
          />
        </div>
      </section>

      <section className='rounded-md border p-4'>
        <h3 className='mb-3 text-sm font-semibold'>Contract Terms</h3>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          <DetailItem
            label='Contract Type'
            value={formatLabel(contractTypeLabels, project.contractType)}
          />
          <DetailItem
            label='Contract Number'
            value={project.contractNumber ?? '-'}
          />
          <DetailItem
            label='Contract Value'
            value={formatMoney(project.currency, project.contractValue)}
          />
          <DetailItem
            label='Contract Completion'
            value={formatDate(project.completionDate ?? null)}
          />
          <DetailItem
            label='Revised Completion'
            value={formatDate(project.revisedCompletionDate ?? null)}
          />
          <DetailItem
            label='LD Rate / Day'
            value={formatMoney(project.currency, project.ldRatePerDay)}
          />
        </div>
      </section>

      <section className='rounded-md border p-4'>
        <h3 className='mb-3 text-sm font-semibold'>Commercial Defaults</h3>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <DetailItem label='Currency' value={project.currency} />
          <DetailItem
            label='Retention'
            value={formatPercent(project.defaultRetentionRate)}
          />
          <DetailItem
            label='Weather Allowance'
            value={formatNumber(project.weatherAllowanceDays, ' days')}
          />
          <DetailItem
            label='Reporting Cutoff'
            value={formatNumber(project.reportingCutoffDay)}
          />
        </div>
      </section>

      <section className='rounded-md border p-4'>
        <h3 className='mb-3 text-sm font-semibold'>Reporting Settings</h3>
        <div className='grid gap-4 sm:grid-cols-2'>
          <DetailItem
            label='Project Calendar'
            value={formatLabel(projectCalendarLabels, project.projectCalendar)}
          />
          <DetailItem
            label='Cutoff Day'
            value={formatNumber(project.reportingCutoffDay)}
          />
          <DetailItem
            label='Data Date'
            value={formatDate(project.dataDate ?? null)}
          />
        </div>
      </section>
    </div>
  )
}
