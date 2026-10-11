import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FeatureAdoption, type NewFeatureDetail, platformIntegrationApi } from '@/services/platform-admin/integration-api'
import { ErrorBlock, KpiTile, LoadingBlock, Section } from './console-ui'
import { fmtNumber, fmtRelative } from '../lib/format'

const hours = (value: number | null) => (value === null ? '—' : value < 3_600_000 ? `${Math.max(1, Math.round(value / 60_000))} min` : `${(value / 3_600_000).toFixed(1)} h`)

/** BIM / 5D, Closeout and Consultant Reviews — counts and metadata only. */
export function NewFeatureTiles({ detail }: { detail: NewFeatureDetail }) {
  const { bim, closeout, consultantReviews: cr } = detail
  return (
    <div className='grid gap-4 lg:grid-cols-3' data-testid='platform-new-features'>
      <Section title='BIM / 5D' description={`Last model ${fmtRelative(bim.lastActivityAt)}`}>
        <dl className='grid grid-cols-2 gap-2 text-sm'>
          <div><dt className='text-xs text-muted-foreground'>Companies / projects</dt><dd className='font-semibold'>{fmtNumber(bim.companies)} / {fmtNumber(bim.projects)}</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Models / revisions</dt><dd className='font-semibold'>{fmtNumber(bim.models)} / {fmtNumber(bim.revisions)}</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Current elements linked</dt><dd className='font-semibold'>{fmtNumber(bim.currentElementsWithLinks)} of {fmtNumber(bim.currentElements)}</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Failed parses</dt><dd className={bim.failedParses ? 'font-semibold text-amber-600' : 'font-semibold'}>{fmtNumber(bim.failedParses)}</dd></div>
        </dl>
      </Section>
      <Section title='Closeout / Turnover' description={`Last deliverable ${fmtRelative(closeout.lastActivityAt)}`}>
        <dl className='grid grid-cols-2 gap-2 text-sm'>
          <div><dt className='text-xs text-muted-foreground'>Projects using it</dt><dd className='font-semibold'>{fmtNumber(closeout.projects)}</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Deliverables (settled)</dt><dd className='font-semibold'>{fmtNumber(closeout.deliverables)} ({fmtNumber(closeout.settled)})</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Substantial / handover</dt><dd className='font-semibold'>{fmtNumber(closeout.projectsSubstantiallyComplete)} / {fmtNumber(closeout.projectsHandedOver)}</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Final completion</dt><dd className='font-semibold'>{fmtNumber(closeout.projectsFinalComplete)}</dd></div>
        </dl>
      </Section>
      <Section title='Consultant Reviews' description={`Last submission ${fmtRelative(cr.lastActivityAt)}`}>
        <dl className='grid grid-cols-2 gap-2 text-sm'>
          <div><dt className='text-xs text-muted-foreground'>Projects with consultants</dt><dd className='font-semibold'>{fmtNumber(cr.projectsWithConsultants)}</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Invited / accepted</dt><dd className='font-semibold'>{fmtNumber(cr.invitationsSent)} / {fmtNumber(cr.invitationsAccepted)}</dd></div>
          <div><dt className='text-xs text-muted-foreground'>Open / overdue</dt><dd className='font-semibold'>{fmtNumber(cr.awaitingConsultant)} / <span className={cr.overdue ? 'text-red-600' : undefined}>{fmtNumber(cr.overdue)}</span></dd></div>
          <div><dt className='text-xs text-muted-foreground'>Completed · avg response</dt><dd className='font-semibold'>{fmtNumber(cr.completed)} · {hours(cr.averageResponseMs)}</dd></div>
        </dl>
      </Section>
    </div>
  )
}

/** Which companies use which capabilities: projects using each, from the records the capability creates. */
export function FeatureAdoptionSection({ orgId = null }: { orgId?: string | null }) {
  const query = useQuery({ queryKey: ['platform-admin', 'features', orgId], queryFn: () => platformIntegrationApi.features(orgId) })
  const d: FeatureAdoption | undefined = query.data
  if (query.isLoading) return <LoadingBlock rows={4} />
  if (query.error) return <ErrorBlock error={query.error} />
  if (!d) return null
  const keys = d.capabilities.filter((c) => c.key !== 'inventory')
  return (
    <div className='space-y-6' data-testid='platform-feature-adoption'>
      <NewFeatureTiles detail={d.detail} />
      <Section title='Capabilities in use' description={d.definitions.uses}>
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8'>
          {d.capabilities.map((c) => (
            <KpiTile key={c.key} label={c.label} value={fmtNumber(c.companies)} hint={c.projects === null ? `${fmtNumber(c.records)} items` : `companies · ${fmtNumber(c.projects)} projects (${fmtNumber(c.projectsActive30d)} active 30 d)`} />
          ))}
        </div>
      </Section>
      {!orgId ? (
        <Section title='By company' description='Projects using each capability, out of the company’s open projects.'>
          <div className='overflow-x-auto'>
            <table className='w-full text-sm tabular-nums'>
              <thead className='text-xs text-muted-foreground'>
                <tr>
                  <th className='px-2 py-1.5 text-left font-medium'>Company</th>
                  <th className='px-2 py-1.5 text-right font-medium'>Projects</th>
                  {keys.map((c) => <th key={c.key} className='px-2 py-1.5 text-right font-medium whitespace-nowrap' title={c.label}>{c.label.split(' (')[0]}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.byCompany.map((row) => (
                  <tr key={row.organisation.id} className='border-t'>
                    <td className='px-2 py-1.5 whitespace-nowrap'><Link to='/platform-admin/companies/$orgId' params={{ orgId: row.organisation.id }} className='text-primary hover:underline'>{row.organisation.name}</Link></td>
                    <td className='px-2 py-1.5 text-right font-semibold'>{fmtNumber(row.projects)}</td>
                    {keys.map((c) => <td key={c.key} className={`px-2 py-1.5 text-right ${row.capabilities[c.key] ? '' : 'text-muted-foreground/50'}`}>{row.capabilities[c.key] || '·'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </div>
  )
}
