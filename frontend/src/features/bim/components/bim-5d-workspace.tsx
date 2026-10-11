import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, Info, Loader2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import {
  useApplyBimSuggestions,
  useBim5dOverview,
  useBim5dReconciliation,
  useBim5dRegister,
  useBim5dRules,
  useBimProvenance,
  useBoqItemElements,
  useSaveMeasurementRule,
  type Figure,
  type ReconRow,
  type ReconStatus,
  type RuleStatus,
  type UnitSum,
} from '../hooks/use-bim-5d'
import { AiAction } from '@/features/ai/components/ai-action'
import { ChangesTab, DuplicatesPanel, ElementCommercialPanel } from './bim-5d-changes'
import { BimPanel } from './bim-panel'

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
const fig = (figure: Figure) => (figure.available ? fmt(figure.value) : '—')
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—')

const STATUS_STYLE: Record<ReconStatus, { label: string; tone: string }> = {
  UNMAPPED: { label: 'Unmapped', tone: 'bg-muted text-muted-foreground' },
  OVER_CONTRACT: { label: 'Over contract', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  UNDER_CONTRACT: { label: 'Under contract', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  BELOW_CERTIFIED: { label: 'Below certified', tone: 'bg-destructive/15 text-destructive' },
  RULE_ISSUES: { label: 'Rule issues', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  MATCHED: { label: 'Matched', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
}
const RULE_STYLE: Record<RuleStatus, string> = {
  VALID: 'text-emerald-700 dark:text-emerald-400',
  WARNING: 'text-amber-700 dark:text-amber-400',
  INVALID: 'text-destructive',
  NOT_CONFIGURED: 'text-muted-foreground',
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', className)}>{children}</span>
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className='rounded-md border bg-card px-3 py-2'>
      <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>{label}</p>
      <p className='mt-0.5 text-lg font-semibold tabular-nums'>{value}</p>
      {hint && <p className='text-[11px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

const unitRows = (sum: UnitSum | undefined) => (!sum ? [] : sum.byUnit ? sum.byUnit : [{ unit: sum.unit || '', value: sum.value }])

// ─── Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ projectId, onOpen }: { projectId: string; onOpen: (tab: string) => void }) {
  const { data, isLoading } = useBim5dOverview(projectId)
  const canLink = useCanPerform('bim', 'update', 'bim.link')
  const apply = useApplyBimSuggestions(projectId)
  if (isLoading || !data) return <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Reading the models…</p>
  const latest = data.models.current[0]
  const states: Array<[string, string, UnitSum | undefined]> = data.quantities
    ? [
        ['Contract', 'BOQ', data.quantities.contract],
        ['BIM current', 'current revisions, measured by rule', data.quantities.bim],
        ['Executed', 'submitted, awaiting approval', data.quantities.executed],
        ['Approved', 'installed, official', data.quantities.approved],
        ['Certified', 'IPC', data.quantities.certified],
        ['Paid', 'IPC, paid certificates', data.quantities.paid],
        ['Potential change', 'BIM above contract', data.quantities.potentialChange],
      ]
    : []
  const units = [...new Set(states.flatMap(([, , sum]) => unitRows(sum).map((row) => row.unit)))]

  const runSuggestions = async () => {
    try {
      let locations = 0
      let boqLinks = 0
      for (const model of data.models.current) {
        const result = await apply.mutateAsync({ modelId: model.id, kinds: ['location', 'boq'] })
        locations += result.locations
        boqLinks += result.boqLinks
      }
      toast.success(`Mapped ${locations} elements to locations and ${boqLinks} to BOQ items`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='space-y-4' data-testid='uat-bim5d-overview'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
        <Tile label='BIM models' value={data.models.count} hint={`${data.models.current.length} current`} />
        <Tile label='Latest revision' value={latest ? latest.revision : '—'} hint={latest ? `${latest.name} · ${day(latest.revisionDate)}` : 'No model yet'} />
        <Tile label='Elements' value={fmt(data.elements.total, 0)} hint='in the current revisions' />
        <Tile label='Mapped' value={`${fmt(data.elements.mappedPct, 1)}%`} hint={`${fmt(data.elements.mapped, 0)} elements`} />
        <Tile label='Unmapped' value={`${fmt(data.elements.unmappedPct, 1)}%`} hint={`${fmt(data.elements.unmapped, 0)} elements`} />
        <Tile label='With a BOQ item' value={fmt(data.elements.withBoq, 0)} hint={`${fmt(data.elements.withLocation, 0)} with a location`} />
      </div>

      <section className='rounded-md border'>
        <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
          <h3 className='text-sm font-semibold'>Commercial quantity states</h3>
          <span className='text-xs text-muted-foreground'>Each from its own authority; never merged into one progress number.</span>
        </div>
        {!data.quantities ? (
          <p className='p-3 text-sm text-muted-foreground'>BOQ quantities need BOQ read access on this project.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm tabular-nums'>
              <thead className='text-xs text-muted-foreground'>
                <tr>
                  <th className='px-3 py-2 text-left font-medium'>State</th>
                  {units.map((unit) => <th key={unit} className='px-3 py-2 text-right font-medium'>{unit}</th>)}
                  <th className='px-3 py-2 text-left font-medium'>Source</th>
                </tr>
              </thead>
              <tbody>
                {states.map(([label, source, sum]) => (
                  <tr key={label} className='border-t'>
                    <td className='px-3 py-1.5 font-medium'>{label}</td>
                    {units.map((unit) => <td key={unit} className='px-3 py-1.5 text-right'>{fmt(unitRows(sum).find((row) => row.unit === unit)?.value ?? null)}</td>)}
                    <td className='px-3 py-1.5 text-xs text-muted-foreground'>{source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className='border-t px-3 py-2 text-xs text-muted-foreground'>{data.quantities.note}</p>
          </div>
        )}
      </section>

      <section className='rounded-md border'>
        <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
          <h3 className='text-sm font-semibold'>Alerts</h3>
          {canLink && data.models.current.length > 0 && (
            <Button size='sm' variant='outline' className='ms-auto' disabled={apply.isPending} onClick={runSuggestions} data-testid='uat-bim5d-apply-suggestions'>
              {apply.isPending ? <Loader2 className='me-1 h-3.5 w-3.5 animate-spin' /> : <Wand2 className='me-1 h-3.5 w-3.5' />}
              Apply mapping suggestions
            </Button>
          )}
        </div>
        <ul className='divide-y'>
          {data.alerts.map((alert) => (
            <li key={alert.key} className='flex items-center gap-3 px-3 py-2 text-sm'>
              {alert.severity === 'ok' ? <CheckCircle2 className='h-4 w-4 text-emerald-600' /> : alert.severity === 'critical' ? <AlertTriangle className='h-4 w-4 text-destructive' /> : alert.severity === 'warning' ? <AlertTriangle className='h-4 w-4 text-amber-600' /> : <Info className='h-4 w-4 text-sky-600' />}
              <span className='flex-1'>{alert.label}</span>
              <span className='font-semibold tabular-nums'>{fmt(alert.count, 0)}</span>
              <Button size='sm' variant='ghost' className='h-7' onClick={() => onOpen(alert.action === 'mapping' ? 'models' : alert.action === 'changes' ? 'changes' : 'reconciliation')}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className='rounded-md border p-3 text-sm'>
        <h3 className='mb-1 font-semibold'>Model formats</h3>
        <ul className='space-y-1'>
          {data.formats.map((format) => (
            <li key={format.format} className='flex flex-wrap items-baseline gap-2'>
              <Pill className={format.status === 'supported' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}>
                {format.status === 'supported' ? 'Supported' : 'Not supported'}
              </Pill>
              <span className='font-medium'>{format.format}{format.versions.length ? ` (${format.versions.join(', ')})` : ''}</span>
              <span className='text-xs text-muted-foreground'>{format.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// ─── Revisions ────────────────────────────────────────────────────────────

function RevisionsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useBim5dRegister(projectId)
  if (isLoading || !data) return <p className='py-6 text-sm text-muted-foreground'>Loading the register…</p>
  if (!data.models.length) return <p className='py-6 text-sm text-muted-foreground'>No model yet. Upload an IFC model under Models.</p>
  return (
    <div className='space-y-4' data-testid='uat-bim5d-revisions'>
      {data.models.map((model) => (
        <section key={model.name} className='rounded-md border'>
          <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
            <h3 className='text-sm font-semibold'>{model.name}</h3>
            {model.discipline && <Badge variant='outline'>{model.discipline}</Badge>}
            <span className='text-xs text-muted-foreground'>Latest {model.latestRevision} · older revisions are kept, never overwritten</span>
          </div>
          <div className='overflow-x-auto'>
            <table className='w-full text-sm tabular-nums'>
              <thead className='text-xs text-muted-foreground'>
                <tr>
                  {['Revision', 'Status', 'Date', 'Format', 'File', 'Checksum (SHA-256)', 'Elements', 'Linked', 'Previous'].map((head) => (
                    <th key={head} className='px-3 py-2 text-left font-medium whitespace-nowrap'>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.revisions.map((rev) => (
                  <tr key={rev.id} className='border-t'>
                    <td className='px-3 py-1.5 font-medium'>{rev.revision}{rev.isCurrent && <Pill className='ms-2 bg-primary/15 text-primary'>Current</Pill>}</td>
                    <td className='px-3 py-1.5'>{rev.status}</td>
                    <td className='px-3 py-1.5'>{day(rev.revisionDate)}</td>
                    <td className='px-3 py-1.5'>{rev.sourceFormat}</td>
                    <td className='max-w-[14rem] truncate px-3 py-1.5' title={rev.fileName || ''}>{rev.fileName || '—'}</td>
                    <td className='px-3 py-1.5 font-mono text-xs' title={rev.checksum || ''}>{rev.checksum ? `${rev.checksum.slice(0, 12)}…` : '—'}</td>
                    <td className='px-3 py-1.5'>{fmt(rev.elementCount, 0)}</td>
                    <td className='px-3 py-1.5'>{fmt(rev.linkedCount, 0)}</td>
                    <td className='px-3 py-1.5'>{model.revisions.find((other) => other.id === rev.previousRevisionId)?.revision || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

// ─── Why this quantity? ───────────────────────────────────────────────────

// Ask OctaPM about this element (BIM-12): the server reads its provenance and
// commercial state as a bim_element record under the caller's access.
const ELEMENT_ACTIONS = [
  { label: 'Explain Quantity', question: 'Explain why this element has the quantity OctaPM shows: the model revision, the measured property, the rule, the conversion and the BOQ item. Use only the recorded figures.' },
  { label: 'Explain Commercial Status', question: "Explain this element's commercial status: is it installed, inspected, approved, certified and paid on its BOQ item, and what is each based on?" },
  { label: 'Explain Why Not Certifiable', question: 'Is this element ready for certification? If not, say exactly what is missing or blocking it (progress, approved quantity at its location, inspections, NCRs).' },
  { label: 'Explain Model Change', question: 'How has this element changed between model revisions, and does the change affect a BOQ item that was already certified?' },
]

function ElementAiActions({ elementId, label }: { elementId: string; label: string }) {
  return (
    <div className='flex flex-wrap gap-1' data-testid='uat-bim5d-element-ai'>
      {ELEMENT_ACTIONS.map((action) => (
        <AiAction key={action.label} label={action.label} question={action.question} record={{ recordType: 'bim_element', recordId: elementId, label }} variant='ghost' className='h-7 px-2 text-xs' />
      ))}
    </div>
  )
}

function ProvenancePanel({ projectId, elementId, boqItemId }: { projectId: string; elementId: string; boqItemId: string | null }) {
  const { data, isLoading } = useBimProvenance(projectId, elementId, boqItemId)
  if (isLoading || !data) return <p className='py-3 text-sm text-muted-foreground'>Tracing the quantity…</p>
  const row = (label: string, value: React.ReactNode) => (
    <div className='contents'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 break-words'>{value}</dd>
    </div>
  )
  return (
    <div className='space-y-3 rounded-md border bg-muted/30 p-3 text-sm' data-testid='uat-bim5d-provenance'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>Why this quantity?</p>
        <ElementAiActions elementId={elementId} label={`${data.element.tag || data.element.name || data.element.globalId} (${data.element.ifcType})`} />
      </div>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
        {row('Element', `${data.element.tag || data.element.name || ''} · ${data.element.ifcType}`)}
        {row('GlobalId', <span className='font-mono text-xs'>{data.element.globalId}</span>)}
        {row('Source', `${data.source.model} ${data.source.revision}${data.source.isCurrentRevision ? '' : ' (superseded)'} · ${day(data.source.revisionDate)}`)}
        {row('Location', data.location?.label || <span className='text-amber-700'>Not mapped (BIM_LOCATION_MISSING)</span>)}
        {row('Storey in the model', data.element.storeyName || '—')}
        {row('WBS', data.wbs?.label || '—')}
        {row('Activity', data.activity?.label || '—')}
      </dl>
      {data.quantitiesWithheld && <p className='text-xs text-muted-foreground'>{data.quantitiesWithheld}</p>}
      {data.quantities.map((quantity) => (
        <div key={quantity.boqItem.id} className='rounded border bg-background p-2'>
          <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
            {row('BOQ', `${quantity.boqItem.code || ''} ${quantity.boqItem.description || ''}`)}
            {row('Measurement', quantity.measurement || '—')}
            {row('Raw', `${fmt(quantity.rawQuantity, 3)} ${quantity.rawUnit || ''}`)}
            {row('Conversion', quantity.factor === null ? '—' : `× ${quantity.factor}${quantity.measurementRule ? `, rounded to ${quantity.measurementRule.rounding} dp` : ''}`)}
            {row('Quantity', <span className='font-semibold'>{fmt(quantity.quantity, 3)} {quantity.unit || ''}</span>)}
            {row('Rule', quantity.measurementRule ? `${quantity.measurementRule.quantityField}${quantity.measurementRule.allowedTypes.length ? ` of ${quantity.measurementRule.allowedTypes.join(', ')}` : ''}${quantity.measurementRule.includeText ? `, name contains "${quantity.measurementRule.includeText}"` : ''}${quantity.measurementRule.excludeText ? `, excluding "${quantity.measurementRule.excludeText}"` : ''}` : 'Not configured')}
            {row('Check', <span className={cn('font-medium', RULE_STYLE[quantity.check.status])}>{quantity.check.status}{quantity.check.reasons.length ? ` — ${quantity.check.reasons.join('; ')}` : ''}</span>)}
            {row('Mapped', `${quantity.method}${quantity.mappedBy ? ` by ${quantity.mappedBy}` : ''} on ${day(quantity.mappedAt)}`)}
          </dl>
        </div>
      ))}
      {!data.quantities.length && !data.quantitiesWithheld && <p className='text-xs text-muted-foreground'>This element is not measured against a BOQ item.</p>}
    </div>
  )
}

function BoqItemSheet({ projectId, row, onClose }: { projectId: string; row: ReconRow | null; onClose: () => void }) {
  const { data, isLoading } = useBoqItemElements(projectId, row?.boqItemId ?? null)
  const [elementId, setElementId] = useState<string | null>(null)
  return (
    <Sheet open={Boolean(row)} onOpenChange={(open) => { if (!open) { setElementId(null); onClose() } }}>
      <SheetContent side='right' className='flex w-full flex-col gap-3 overflow-y-auto sm:max-w-2xl' data-testid='uat-bim5d-boq-sheet'>
        <SheetHeader>
          <SheetTitle>{row ? `${row.code} · ${row.description}` : ''}</SheetTitle>
          <SheetDescription>
            {row ? `Contract ${fmt(row.contract)} ${row.unit || ''} · BIM ${fmt(row.bim)} · approved ${fig(row.approved)} · certified ${fig(row.certified)} · paid ${fig(row.paid)}` : ''}
          </SheetDescription>
        </SheetHeader>
        {isLoading || !data ? (
          <p className='text-sm text-muted-foreground'>Loading the mapped elements…</p>
        ) : (
          <>
            <p className='text-xs text-muted-foreground'>
              {data.items.length} element{data.items.length === 1 ? '' : 's'} in the current revisions, {fmt(data.total, 3)} {data.boqItem.unit || ''} measured
              {data.rule ? ` by ${data.rule.quantityField}` : ' (no measurement rule)'}. Select one to see why its quantity counts.
            </p>
            <div className='overflow-x-auto rounded border'>
              <table className='w-full text-sm tabular-nums'>
                <thead className='text-xs text-muted-foreground'>
                  <tr>{['Element', 'Type', 'Storey', 'Measured', 'Quantity', 'Rule'].map((head) => <th key={head} className='px-2 py-1.5 text-left font-medium'>{head}</th>)}</tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.linkId} className={cn('cursor-pointer border-t hover:bg-muted/50', elementId === item.elementId && 'bg-primary/10')} onClick={() => setElementId(item.elementId)}>
                      <td className='px-2 py-1'>{item.tag || item.name}</td>
                      <td className='px-2 py-1 text-xs'>{item.ifcType}</td>
                      <td className='px-2 py-1 text-xs'>{item.storeyName || '—'}</td>
                      <td className='px-2 py-1 text-xs'>{item.quantityField || '—'}</td>
                      <td className='px-2 py-1 text-right'>{fmt(item.quantity, 3)}</td>
                      <td className={cn('px-2 py-1 text-xs font-medium', RULE_STYLE[item.check.status])}>{item.check.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {elementId && <ProvenancePanel projectId={projectId} elementId={elementId} boqItemId={row?.boqItemId ?? null} />}
            {elementId && <ElementCommercialPanel projectId={projectId} elementId={elementId} />}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Commercial reconciliation ────────────────────────────────────────────

const FILTERS: Array<{ key: string; label: string; test: (row: ReconRow) => boolean }> = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'unmapped', label: 'Unmapped', test: (row) => row.status === 'UNMAPPED' },
  { key: 'over', label: 'Over contract', test: (row) => row.status === 'OVER_CONTRACT' },
  { key: 'under', label: 'Under contract', test: (row) => row.status === 'UNDER_CONTRACT' },
  { key: 'certified', label: 'Previously certified', test: (row) => (row.certified.value ?? 0) > 0 },
  { key: 'below', label: 'Below certified', test: (row) => row.status === 'BELOW_CERTIFIED' },
  { key: 'unapproved', label: 'Unapproved', test: (row) => (row.executed ?? 0) > 0 },
  { key: 'variation', label: 'Potential variation', test: (row) => (row.variation ?? 0) > 0 },
  { key: 'rules', label: 'Rule issues', test: (row) => row.ruleChecks.invalid + row.ruleChecks.warning > 0 || row.rule.status === 'NOT_CONFIGURED' },
]

function ReconciliationTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useBim5dReconciliation(projectId)
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<ReconRow | null>(null)
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => (FILTERS.find((item) => item.key === filter) ?? FILTERS[0]).test(row)), [data, filter])
  if (error) return <p className='py-6 text-sm text-muted-foreground'>{getServerErrorMessage(error)}</p>
  if (isLoading || !data) return <p className='py-6 text-sm text-muted-foreground'>Reconciling…</p>
  return (
    <div className='space-y-3' data-testid='uat-bim5d-reconciliation'>
      <p className='text-xs text-muted-foreground'>
        Per BOQ item, every commercial quantity from its own authority. Current revisions: {data.models.map((model) => `${model.name} ${model.revision}`).join(', ') || 'none'}. Over/under contract beyond ±{data.tolerancePct}%.
      </p>
      <div className='flex flex-wrap gap-1'>
        {FILTERS.map((item) => (
          <button key={item.key} type='button' aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className='h-7 rounded-md border px-2 text-xs text-muted-foreground aria-pressed:border-primary/60 aria-pressed:bg-primary/10 aria-pressed:text-primary'>
            {item.label}
          </button>
        ))}
      </div>
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm tabular-nums'>
          <thead className='text-xs text-muted-foreground'>
            <tr>
              {['BOQ', 'Description', 'Unit', 'Contract', 'Current BIM', 'Elements', 'Executed', 'Approved', 'Certified', 'Paid', 'Variation', 'Difference', 'Rule', 'Status'].map((head) => (
                <th key={head} className={cn('px-2 py-2 font-medium whitespace-nowrap', ['BOQ', 'Description', 'Unit', 'Rule', 'Status'].includes(head) ? 'text-left' : 'text-right')}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.boqItemId} className='cursor-pointer border-t hover:bg-muted/50' onClick={() => setOpen(row)} data-testid='uat-bim5d-recon-row'>
                <td className='px-2 py-1.5 font-medium'>{row.code}</td>
                <td className='max-w-[16rem] truncate px-2 py-1.5' title={row.description}>{row.description}</td>
                <td className='px-2 py-1.5'>{row.unit}</td>
                <td className='px-2 py-1.5 text-right'>{fmt(row.contract)}</td>
                <td className='px-2 py-1.5 text-right'>{fmt(row.bim)}</td>
                <td className='px-2 py-1.5 text-right'>{row.mappedElements}</td>
                <td className='px-2 py-1.5 text-right' title='Submitted, awaiting approval'>{fmt(row.executed)}</td>
                <td className='px-2 py-1.5 text-right' title={row.approved.reason || 'Installed, official'}>{fig(row.approved)}</td>
                <td className='px-2 py-1.5 text-right' title={row.certified.reason || 'IPC'}>{fig(row.certified)}</td>
                <td className='px-2 py-1.5 text-right' title={row.paid.reason || 'IPC'}>{fig(row.paid)}</td>
                <td className='px-2 py-1.5 text-right'>{fmt(row.variation)}</td>
                <td className={cn('px-2 py-1.5 text-right', (row.difference ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : (row.difference ?? 0) < 0 ? 'text-sky-700 dark:text-sky-400' : '')}>{fmt(row.difference)}</td>
                <td className={cn('px-2 py-1.5 text-xs font-medium', RULE_STYLE[row.rule.status])}>{row.rule.status}</td>
                <td className='px-2 py-1.5'><Pill className={STATUS_STYLE[row.status].tone}>{STATUS_STYLE[row.status].label}</Pill></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={14} className='px-3 py-6 text-center text-sm text-muted-foreground'>No BOQ item matches this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <DuplicatesPanel projectId={projectId} />
      <details className='text-xs text-muted-foreground'>
        <summary className='cursor-pointer'>Where each figure comes from</summary>
        <ul className='mt-1 list-disc ps-5'>{Object.entries(data.basis).map(([keyName, text]) => <li key={keyName}><span className='font-medium'>{keyName}</span>: {text}</li>)}</ul>
      </details>
      <BoqItemSheet projectId={projectId} row={open} onClose={() => setOpen(null)} />
    </div>
  )
}

// ─── Measurement rules ────────────────────────────────────────────────────

function RulesTab({ projectId }: { projectId: string }) {
  const { data: rules } = useBim5dRules(projectId)
  const { data: recon } = useBim5dReconciliation(projectId)
  const canEdit = useCanPerform('bim', 'update', 'bim.link')
  const save = useSaveMeasurementRule(projectId)
  const [editing, setEditing] = useState<ReconRow | null>(null)
  const [form, setForm] = useState({ quantityField: 'netVolume', allowedTypes: '', factor: '1', unit: '', includeText: '', excludeText: '' })
  const ruleFor = (boqItemId: string) => rules?.items.find((rule) => rule.boqItemId === boqItemId) || null
  const startEdit = (row: ReconRow) => {
    const rule = ruleFor(row.boqItemId)
    setForm({ quantityField: rule?.quantityField || 'netVolume', allowedTypes: (rule?.allowedTypes || []).join(', '), factor: String(rule?.factor ?? 1), unit: rule?.unit || row.unit || '', includeText: rule?.includeText || '', excludeText: rule?.excludeText || '' })
    setEditing(row)
  }
  const submit = async () => {
    if (!editing) return
    try {
      await save.mutateAsync({ boqItemId: editing.boqItemId, quantityField: form.quantityField, allowedTypes: form.allowedTypes.split(',').map((text) => text.trim()).filter(Boolean), factor: Number(form.factor) || 1, unit: form.unit || null, includeText: form.includeText || null, excludeText: form.excludeText || null })
      toast.success(`Measurement rule saved for ${editing.code}`)
      setEditing(null)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <div className='space-y-3' data-testid='uat-bim5d-rules'>
      <p className='text-xs text-muted-foreground'>
        Deterministic contract measurement: which measured property of an element is the BOQ quantity, for which element types, with which conversion. OctaPM checks every mapped element against it (VALID / WARNING / INVALID / NOT CONFIGURED); the AI never decides it.
      </p>
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='text-xs text-muted-foreground'>
            <tr>{['BOQ', 'Description', 'Unit', 'Measures', 'Element types', 'Factor', 'Filters', 'Checks', ''].map((head) => <th key={head} className='px-2 py-2 text-left font-medium'>{head}</th>)}</tr>
          </thead>
          <tbody>
            {(recon?.rows ?? []).map((row) => {
              const rule = ruleFor(row.boqItemId)
              return (
                <tr key={row.boqItemId} className='border-t'>
                  <td className='px-2 py-1.5 font-medium'>{row.code}</td>
                  <td className='max-w-[14rem] truncate px-2 py-1.5'>{row.description}</td>
                  <td className='px-2 py-1.5'>{row.unit}</td>
                  <td className='px-2 py-1.5'>{rule?.quantityField || <span className='text-muted-foreground'>Not configured</span>}</td>
                  <td className='px-2 py-1.5 text-xs'>{rule?.allowedTypes.join(', ') || (rule ? 'Any' : '—')}</td>
                  <td className='px-2 py-1.5 tabular-nums'>{rule ? rule.factor : '—'}</td>
                  <td className='px-2 py-1.5 text-xs'>{[rule?.includeText && `contains "${rule.includeText}"`, rule?.excludeText && `excludes "${rule.excludeText}"`].filter(Boolean).join(', ') || '—'}</td>
                  <td className='px-2 py-1.5 text-xs tabular-nums'>
                    <span className={RULE_STYLE.VALID}>{row.ruleChecks.valid} valid</span>
                    {row.ruleChecks.warning > 0 && <span className={cn('ms-2', RULE_STYLE.WARNING)}>{row.ruleChecks.warning} warning</span>}
                    {row.ruleChecks.invalid > 0 && <span className={cn('ms-2', RULE_STYLE.INVALID)}>{row.ruleChecks.invalid} invalid</span>}
                  </td>
                  <td className='px-2 py-1.5 text-right'>{canEdit && <Button size='sm' variant='ghost' className='h-7' onClick={() => startEdit(row)}>Edit</Button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Measurement rule · {editing?.code}</DialogTitle>
            <DialogDescription>{editing?.description}</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3 text-sm'>
            <label className='grid gap-1'>Measured property
              <select className='h-9 rounded-md border bg-background px-2' value={form.quantityField} onChange={(event) => setForm({ ...form, quantityField: event.target.value })}>
                {(rules?.quantityFields ?? []).map((field) => <option key={field} value={field}>{field}</option>)}
              </select>
            </label>
            <label className='grid gap-1'>Element types (IFC, comma separated; empty = any)<Input value={form.allowedTypes} onChange={(event) => setForm({ ...form, allowedTypes: event.target.value })} placeholder='IFCCOLUMN, IFCSLAB' /></label>
            <div className='grid grid-cols-2 gap-3'>
              <label className='grid gap-1'>Conversion factor<Input value={form.factor} inputMode='decimal' onChange={(event) => setForm({ ...form, factor: event.target.value })} /></label>
              <label className='grid gap-1'>Unit<Input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <label className='grid gap-1'>Name contains<Input value={form.includeText} onChange={(event) => setForm({ ...form, includeText: event.target.value })} /></label>
              <label className='grid gap-1'>Name excludes<Input value={form.excludeText} onChange={(event) => setForm({ ...form, excludeText: event.target.value })} /></label>
            </div>
            <div className='flex justify-end gap-2'>
              <Button variant='ghost' onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={submit} disabled={save.isPending}>{save.isPending && <Loader2 className='me-1 h-4 w-4 animate-spin' />}Save rule</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Workspace ────────────────────────────────────────────────────────────

/**
 * Project › BIM / 5D: commercial intelligence on the project's own models,
 * BOQ, schedule, locations, progress and IPC. The model register and element
 * browser (Models) are the existing BIM module.
 */
export function Bim5dWorkspace({ projectId, initialTarget }: { projectId: string; initialTarget?: ProjectSetupTarget }) {
  const canReadBoq = useCanPerform('boq', 'read')
  const [tab, setTab] = useState(initialTarget?.source === 'bim_model' ? 'models' : 'overview')
  return (
    <div className='space-y-3' data-testid='uat-bim5d'>
      <div className='flex flex-wrap items-baseline gap-2'>
        <h2 className='text-lg font-semibold'>BIM / 5D</h2>
        <p className='text-xs text-muted-foreground'>
          Element → revision → location → activity → BOQ → executed → approved → certified → paid: why each quantity is commercially valid.
        </p>
        <span className='ms-auto inline-flex items-center gap-1 text-xs text-muted-foreground' title='OctaPM parses IFC directly. Native Revit (RVT) needs Autodesk Platform Services, which is not connected.'>
          <CircleHelp className='h-3.5 w-3.5' /> IFC supported · RVT not yet
        </span>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className='h-auto flex-wrap'>
          <TabsTrigger value='overview'>Overview</TabsTrigger>
          <TabsTrigger value='models'>Models &amp; elements</TabsTrigger>
          <TabsTrigger value='revisions'>Revisions</TabsTrigger>
          <TabsTrigger value='changes'>Changes</TabsTrigger>
          {canReadBoq && <TabsTrigger value='reconciliation'>Commercial reconciliation</TabsTrigger>}
          {canReadBoq && <TabsTrigger value='rules'>Measurement rules</TabsTrigger>}
        </TabsList>
        <TabsContent value='overview'><OverviewTab projectId={projectId} onOpen={setTab} /></TabsContent>
        <TabsContent value='models'><BimPanel projectId={projectId} initialTarget={initialTarget} /></TabsContent>
        <TabsContent value='revisions'><RevisionsTab projectId={projectId} /></TabsContent>
        <TabsContent value='changes'><ChangesTab projectId={projectId} /></TabsContent>
        {canReadBoq && <TabsContent value='reconciliation'><ReconciliationTab projectId={projectId} /></TabsContent>}
        {canReadBoq && <TabsContent value='rules'><RulesTab projectId={projectId} /></TabsContent>}
      </Tabs>
    </div>
  )
}
