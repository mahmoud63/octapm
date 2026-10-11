import { useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useChangeEvents } from '@/features/change-events/hooks/use-change-events'
import {
  useBim5dRegister,
  useBimDuplicates,
  useCarryForward,
  useDecideReview,
  useElementCommercialState,
  useElementHistory,
  useOpenRevisionReviews,
  useRevisionDiff,
} from '../hooks/use-bim-5d'

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
const signed = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${fmt(value)}`)

const KIND_TONE: Record<string, string> = {
  added: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  removed: 'bg-destructive/15 text-destructive',
  modified: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}
const REVIEW_LABEL: Record<string, string> = { open: 'Open', ignored: 'Ignored', associated: 'Associated', draft_created: 'Change event raised' }

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className='rounded-md border bg-card px-3 py-2'>
      <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  )
}

/** BIM-7/9/11: one revision against the previous one, and the commercial review of each change. */
export function ChangesTab({ projectId }: { projectId: string }) {
  const { data: register } = useBim5dRegister(projectId)
  const models = (register?.models ?? []).filter((model) => model.revisions.length > 1)
  const [modelName, setModelName] = useState<string | null>(null)
  const model = models.find((row) => row.name === modelName) ?? models[0]
  const current = model?.revisions.find((rev) => rev.isCurrent) ?? model?.revisions[0]
  const { data: diff, isLoading } = useRevisionDiff(projectId, current?.id ?? null)
  const canLink = useCanPerform('bim', 'update', 'bim.link')
  const canRaise = useCanPerform('change_event', 'create')
  const openReviews = useOpenRevisionReviews(projectId)
  const carry = useCarryForward(projectId)
  const decide = useDecideReview(projectId)
  const { data: events } = useChangeEvents(projectId)
  const [associating, setAssociating] = useState<string | null>(null)

  if (!register) return <p className='py-6 text-sm text-muted-foreground'>Loading…</p>
  if (!models.length) return <p className='py-6 text-sm text-muted-foreground'>A model needs two revisions to compare. Upload the next revision of a model under Models &amp; elements.</p>

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast.success(done)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const summary = diff?.summary

  return (
    <div className='space-y-4' data-testid='uat-bim5d-changes'>
      <div className='flex flex-wrap items-center gap-2'>
        <select className='h-8 rounded-md border bg-background px-2 text-sm' value={model?.name} onChange={(event) => setModelName(event.target.value)} aria-label='Model'>
          {models.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
        </select>
        {diff?.from && typeof diff.to !== 'string' && <span className='text-sm font-medium'>Revision impact: {diff.to.revision} vs {diff.from.revision}</span>}
        {canLink && current && (
          <div className='ms-auto flex flex-wrap gap-2'>
            <Button size='sm' variant='outline' disabled={carry.isPending} onClick={() => run(() => carry.mutateAsync(current.id), 'Mappings carried onto the new revision; BOQ quantities re-measured from it')}>
              {carry.isPending && <Loader2 className='me-1 h-3.5 w-3.5 animate-spin' />}Carry mappings forward
            </Button>
            <Button size='sm' disabled={openReviews.isPending} onClick={() => run(() => openReviews.mutateAsync(current.id), 'Commercial reviews opened for the BOQ-impacting changes')}>
              {openReviews.isPending && <Loader2 className='me-1 h-3.5 w-3.5 animate-spin' />}Open commercial reviews
            </Button>
          </div>
        )}
      </div>

      {isLoading || !diff ? (
        <p className='text-sm text-muted-foreground'>Comparing revisions…</p>
      ) : !summary ? (
        <p className='text-sm text-muted-foreground'>{diff.note}</p>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8'>
            <Tile label='Added' value={summary.added} />
            <Tile label='Removed' value={summary.removed} />
            <Tile label='Modified' value={summary.modified} />
            <Tile label='Unchanged' value={summary.unchanged} />
            <Tile label='Quantity changed' value={summary.quantityChanged} />
            <Tile label='BOQ-impacting' value={summary.boqImpacting} />
            <Tile label='Previously certified changed' value={summary.previouslyCertifiedChanged} tone={summary.previouslyCertifiedChanged ? 'text-destructive' : undefined} />
            <Tile label='Potential variation value' value={summary.potentialVariationValue === null ? '—' : signed(summary.potentialVariationValue)} />
          </div>

          {summary.previouslyCertifiedChanged > 0 && (
            <div className='flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm' data-testid='uat-bim5d-cert-warning'>
              <AlertTriangle className='mt-0.5 h-4 w-4 text-destructive' />
              <div>
                <p className='font-semibold'>MODEL CHANGE AFTER CERTIFICATION — commercial review required</p>
                <p className='text-muted-foreground'>
                  {summary.previouslyCertifiedChanged} element{summary.previouslyCertifiedChanged === 1 ? '' : 's'} on BOQ items with certified quantity {summary.previouslyCertifiedChanged === 1 ? 'was' : 'were'} removed or reduced.
                  Certified history is never rewritten: the certificates stand until a person decides.
                </p>
                <ul className='mt-1 list-disc ps-5'>
                  {(diff.byBoqItem ?? []).filter((row) => (row.certified ?? 0) > 0).map((row) => (
                    <li key={row.boqItemId}>{row.code}: previously certified {fmt(row.certified)} {row.unit}; revision changes the measured quantity by {signed(row.deltaQuantity)} {row.unit}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <section className='rounded-md border'>
            <div className='border-b px-3 py-2 text-sm font-semibold'>Impact by BOQ item</div>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm tabular-nums'>
                <thead className='text-xs text-muted-foreground'><tr>{['BOQ', 'Description', 'Elements', 'Quantity change', 'Value at BOQ rate', 'Certified to date'].map((head) => <th key={head} className='px-3 py-2 text-left font-medium'>{head}</th>)}</tr></thead>
                <tbody>
                  {(diff.byBoqItem ?? []).map((row) => (
                    <tr key={row.boqItemId} className='border-t'>
                      <td className='px-3 py-1.5 font-medium'>{row.code}</td>
                      <td className='max-w-[16rem] truncate px-3 py-1.5'>{row.description}</td>
                      <td className='px-3 py-1.5'>{row.elements}</td>
                      <td className='px-3 py-1.5'>{signed(row.deltaQuantity)} {row.unit}</td>
                      <td className='px-3 py-1.5'>{row.deltaValue === null ? '—' : signed(row.deltaValue)}</td>
                      <td className='px-3 py-1.5'>{fmt(row.certified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className='rounded-md border'>
            <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
              <span className='text-sm font-semibold'>Potential changes</span>
              <span className='text-xs text-muted-foreground'>{diff.note}</span>
            </div>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm tabular-nums'>
                <thead className='text-xs text-muted-foreground'><tr>{['Change', 'Element', 'Storey', 'BOQ', 'Quantity', 'What changed', 'Review', ''].map((head) => <th key={head} className='px-2 py-2 text-left font-medium'>{head}</th>)}</tr></thead>
                <tbody>
                  {(diff.changes ?? []).map((change) => (
                    <tr key={change.globalId} className='border-t align-top'>
                      <td className='px-2 py-1.5'><span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', KIND_TONE[change.kind])}>{change.kind}</span>{change.certifiedOnItem && <span className='ms-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive'>certified item</span>}</td>
                      <td className='px-2 py-1.5'>{change.label}<span className='block text-[11px] text-muted-foreground'>{change.ifcType}</span></td>
                      <td className='px-2 py-1.5 text-xs'>{change.storeyName || '—'}</td>
                      <td className='px-2 py-1.5'>{change.boqCode || '—'}</td>
                      <td className='px-2 py-1.5'>{signed(change.deltaQuantity)} {change.unit || ''}</td>
                      <td className='px-2 py-1.5 text-xs'>{change.changes.length ? change.changes.map((item) => `${item.field}: ${item.from ?? '—'} → ${item.to ?? '—'}`).join('; ') : change.kind === 'added' ? 'new in this revision' : 'not in this revision'}</td>
                      <td className='px-2 py-1.5 text-xs'>{change.review ? REVIEW_LABEL[change.review.status] ?? change.review.status : '—'}</td>
                      <td className='px-2 py-1.5'>
                        {change.review && canLink && (
                          <div className='flex flex-wrap gap-1'>
                            {change.review.status !== 'ignored' && <Button size='sm' variant='ghost' className='h-7 px-2' onClick={() => run(() => decide.mutateAsync({ reviewId: change.review!.id, action: 'ignore' }), 'Marked as no commercial effect')}>Ignore</Button>}
                            {associating === change.review.id ? (
                              <select className='h-7 rounded border bg-background px-1 text-xs' defaultValue='' onChange={(event) => { const id = event.target.value; setAssociating(null); if (id) run(() => decide.mutateAsync({ reviewId: change.review!.id, action: 'associate', changeEventId: id }), 'Associated with the change event') }}>
                                <option value='' disabled>Choose a change event…</option>
                                {(events?.items ?? []).map((event) => <option key={event.id} value={event.id}>CE-{event.number} {event.title}</option>)}
                              </select>
                            ) : (
                              <Button size='sm' variant='ghost' className='h-7 px-2' onClick={() => setAssociating(change.review!.id)}>Associate</Button>
                            )}
                            {canRaise && change.review.status !== 'draft_created' && <Button size='sm' variant='outline' className='h-7 px-2' onClick={() => run(() => decide.mutateAsync({ reviewId: change.review!.id, action: 'draft_change_event' }), 'Open change event raised (not approved)')}>Raise change event</Button>}
                            {change.review.status !== 'open' && <Button size='sm' variant='ghost' className='h-7 px-2' onClick={() => run(() => decide.mutateAsync({ reviewId: change.review!.id, action: 'reopen' }), 'Review reopened')}>Reopen</Button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/** BIM-8: potential duplicate quantity, with the records responsible. Nothing is deleted. */
export function DuplicatesPanel({ projectId }: { projectId: string }) {
  const { data } = useBimDuplicates(projectId)
  if (!data) return null
  return (
    <section className='rounded-md border' data-testid='uat-bim5d-duplicates'>
      <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <ArrowRightLeft className='h-4 w-4' />
        <span className='text-sm font-semibold'>Potential duplicate quantity</span>
        <span className='text-xs text-muted-foreground'>{data.note}</span>
      </div>
      {!data.findings.length ? (
        <p className='px-3 py-2 text-sm text-muted-foreground'>None found in the current revisions.</p>
      ) : (
        <ul className='divide-y'>
          {data.findings.map((finding, index) => (
            <li key={index} className='px-3 py-2 text-sm'>
              <p className='font-medium'><span className='me-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] text-destructive'>POTENTIAL DUPLICATE</span>{finding.label}</p>
              <ul className='mt-1 text-xs text-muted-foreground'>{finding.records.map((record) => <li key={record.linkId}>{record.element} · {record.model} · {record.boqCode} · {fmt(record.quantity, 3)} ({record.measured})</li>)}</ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const STATE_TONE: Record<string, string> = {
  APPROVED_FOR_CERTIFICATION: 'text-emerald-700 dark:text-emerald-400',
  ACTIVITY_IN_PROGRESS: 'text-amber-700 dark:text-amber-400',
  INSPECTION_PENDING: 'text-amber-700 dark:text-amber-400',
  BLOCKED_BY_HOLD_POINT: 'text-destructive',
  BLOCKED_BY_NCR: 'text-destructive',
  INSPECTION_FAILED: 'text-destructive',
}

/** BIM-10/16: the element's commercial state and its history across revisions. */
export function ElementCommercialPanel({ projectId, elementId }: { projectId: string; elementId: string }) {
  const { data: state } = useElementCommercialState(projectId, elementId)
  const { data: history } = useElementHistory(projectId, elementId)
  if (!state) return <p className='text-xs text-muted-foreground'>Reading the commercial state…</p>
  return (
    <div className='space-y-2 rounded-md border bg-background p-3 text-sm' data-testid='uat-bim5d-element-state'>
      <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>Commercial state</p>
      <p className={cn('font-semibold', STATE_TONE[state.state] || '')}>{state.state.replace(/_/g, ' ')}</p>
      <ul className='list-disc ps-5 text-xs text-muted-foreground'>{state.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs'>
        <dt className='text-muted-foreground'>Progress</dt>
        <dd>{state.progress ? `${state.progress.activity}: ${state.progress.officialPct}% official; approved qty ${fmt(state.progress.approvedQuantity)}, submitted ${fmt(state.progress.submittedQuantity)}${state.progress.approvedAtElementLocation !== null ? `, approved at this location ${fmt(state.progress.approvedAtElementLocation)}` : ''}` : '—'}</dd>
        <dt className='text-muted-foreground'>Inspections</dt>
        <dd>{state.inspections.length ? state.inspections.map((row) => `${row.ref} ${row.pointType} ${row.status}`).join('; ') : 'None on its activity'}</dd>
        <dt className='text-muted-foreground'>NCRs / holds</dt>
        <dd>{state.ncrs.length ? state.ncrs.map((row) => `${row.ref} (${row.severity}, ${row.status})`).join('; ') : 'None open'}</dd>
        <dt className='text-muted-foreground'>Certified</dt>
        <dd>{state.certified ? `${fmt(state.certified.onItem)} ${state.certified.unit || ''} on ${state.certified.boqItem} (BOQ item, to date)` : '—'}</dd>
        <dt className='text-muted-foreground'>Paid</dt>
        <dd>{state.paid ? `${fmt(state.paid.onItem)} ${state.paid.unit || ''} on ${state.paid.boqItem}` : '—'}</dd>
      </dl>
      {history && history.revisions.length > 0 && (
        <div>
          <p className='mt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>Model-change history</p>
          <ul className='text-xs tabular-nums'>
            {history.revisions.map((rev) => (
              <li key={rev.elementId}>{rev.revision}{rev.isCurrent ? ' (current)' : ''} · {rev.date.slice(0, 10)} · {rev.storeyName || '—'} · vol {fmt(rev.netVolume, 3)} · area {fmt(rev.netArea, 3)}</li>
            ))}
            {history.reviews.map((review, index) => <li key={index} className='text-muted-foreground'>Review: {review.kind} — {REVIEW_LABEL[review.status] ?? review.status}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
