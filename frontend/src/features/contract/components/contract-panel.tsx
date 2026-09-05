import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import { useDocumentSearch } from '@/features/doc-control/hooks/use-document-search'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import {
  useContractProfile,
  useCreateNotice,
  useDraftNotice,
  useExtractContractClauses,
  useNoticeMonitor,
  useUpdateContractProfile,
  type ClauseCategory,
  type ContractClause,
  type ContractForm,
  type ContractProfile,
  type NoticeDraft,
  type NoticeItem,
  type NoticeStatus,
} from '../hooks/use-contract'

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'

const CATEGORY_LABEL: Record<ClauseCategory, string> = {
  notice: 'Notice',
  eot: 'Extension of time',
  variation: 'Variation',
  payment: 'Payment',
  ld: 'Liquidated damages',
  retention: 'Retention',
  defects: 'Defects',
  suspension: 'Suspension',
  force_majeure: 'Force majeure',
  dispute: 'Dispute',
  other: 'Other',
}

const STATUS_LABEL: Record<NoticeStatus, string> = {
  missed: 'Missed',
  due: 'Due',
  late: 'Served late',
  served: 'Served',
  not_required: 'Not required',
}
const statusVariant = (status: NoticeStatus) =>
  status === 'missed'
    ? 'destructive'
    : status === 'due' || status === 'late'
      ? 'secondary'
      : 'outline'
const KIND_LABEL = {
  delay: 'Delay event',
  variation: 'Variation',
  incoming_notice: 'Incoming notice',
} as const

type Periods = {
  form: ContractForm
  delayNoticeDays: string
  claimParticularsDays: string
  variationNoticeDays: string
  responseDays: string
  paymentDays: string
  defectsLiabilityDays: string
  ldCapPct: string
}
const periodsFrom = (profile: ContractProfile): Periods => ({
  form: profile.form,
  delayNoticeDays: String(profile.delayNoticeDays),
  claimParticularsDays: String(profile.claimParticularsDays),
  variationNoticeDays: String(profile.variationNoticeDays),
  responseDays: String(profile.responseDays),
  paymentDays: profile.paymentDays === null ? '' : String(profile.paymentDays),
  defectsLiabilityDays:
    profile.defectsLiabilityDays === null
      ? ''
      : String(profile.defectsLiabilityDays),
  ldCapPct: profile.ldCapPct === null ? '' : String(profile.ldCapPct),
})
const intOrNull = (value: string) =>
  value.trim() === '' ? null : Number(value)

function ProfileCard({
  projectId,
  profile,
  canEdit,
}: {
  projectId: string
  profile: ContractProfile
  canEdit: boolean
}) {
  const update = useUpdateContractProfile(projectId)
  const extract = useExtractContractClauses(projectId)
  const [periods, setPeriods] = useState<Periods>(() => periodsFrom(profile))
  const [documentIds, setDocumentIds] = useState<string[]>(profile.documentIds)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const { data: search } = useDocumentSearch(projectId, query, {
    limit: 8,
    enabled: query.trim().length >= 2,
  })
  const [extraction, setExtraction] = useState<{
    degraded: boolean
    reason?: string | null
    proposed: number
    suggested: Record<string, number | null>
    windowsRead: number
  } | null>(null)

  const applyPreset = (form: ContractForm) => {
    const preset = profile.presets.find((item) => item.key === form)
    setPeriods((previous) => ({
      ...previous,
      form,
      ...(preset
        ? {
            delayNoticeDays: String(preset.delayNoticeDays),
            claimParticularsDays: String(preset.claimParticularsDays),
            variationNoticeDays: String(preset.variationNoticeDays),
            responseDays: String(preset.responseDays),
          }
        : {}),
    }))
  }

  const save = async () => {
    try {
      await update.mutateAsync({
        form: periods.form,
        delayNoticeDays: intOrNull(periods.delayNoticeDays),
        claimParticularsDays: intOrNull(periods.claimParticularsDays),
        variationNoticeDays: intOrNull(periods.variationNoticeDays),
        responseDays: intOrNull(periods.responseDays),
        paymentDays: intOrNull(periods.paymentDays),
        defectsLiabilityDays: intOrNull(periods.defectsLiabilityDays),
        ldCapPct: intOrNull(periods.ldCapPct),
        documentIds,
      })
      toast.success('Contract profile saved')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const runExtract = async () => {
    try {
      const result = await extract.mutateAsync({ documentIds })
      setExtraction({
        degraded: result.degraded,
        reason: result.reason,
        proposed: result.proposed.length,
        suggested: result.suggestedPeriods,
        windowsRead: result.windowsRead,
      })
      toast.success(
        `${result.proposed.length} clause${result.proposed.length === 1 ? '' : 's'} proposed — review them below`
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const field = (
    key: keyof Omit<Periods, 'form'>,
    label: string,
    hint?: string
  ) => (
    <div className='space-y-1'>
      <Label htmlFor={`contract-${key}`}>{label}</Label>
      <Input
        id={`contract-${key}`}
        type='number'
        min={0}
        value={periods[key]}
        onChange={(event) =>
          setPeriods((previous) => ({ ...previous, [key]: event.target.value }))
        }
        disabled={!canEdit}
        data-testid={`uat-contract-${key}`}
      />
      {hint ? (
        <p className='text-[10px] text-muted-foreground'>{hint}</p>
      ) : null}
    </div>
  )

  return (
    <section
      className='space-y-3 rounded-md border bg-card p-3'
      data-testid='uat-contract-profile'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <h4 className='text-sm font-semibold'>Contract profile</h4>
        <span className='text-xs text-muted-foreground'>
          {profile.exists
            ? `${profile.formLabel}${profile.confirmedAt ? ` · clauses confirmed ${formatDate(profile.confirmedAt)}` : ''}`
            : 'Not saved yet — defaults shown'}
        </span>
      </div>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <div className='space-y-1'>
          <Label>Form of contract</Label>
          <Select
            value={periods.form}
            onValueChange={(value) => applyPreset(value as ContractForm)}
            disabled={!canEdit}
          >
            <SelectTrigger data-testid='uat-contract-form'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profile.presets.map((preset) => (
                <SelectItem key={preset.key} value={preset.key}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-[10px] text-muted-foreground'>
            Choosing a form fills its usual periods; edit them to match your
            particular conditions.
          </p>
        </div>
        {field(
          'delayNoticeDays',
          'Notice of delay event (days)',
          profile.references.notice
        )}
        {field(
          'claimParticularsDays',
          'Claim particulars (days)',
          'After the notice'
        )}
        {field(
          'variationNoticeDays',
          'Notice of variation (days)',
          profile.references.variation
        )}
        {field(
          'responseDays',
          'Response to a notice (days)',
          profile.references.response
        )}
        {field('paymentDays', 'Payment (days)')}
        {field('defectsLiabilityDays', 'Defects liability (days)')}
        {field('ldCapPct', 'LD cap (% of contract price)')}
      </div>

      <div className='space-y-2'>
        <Label>Contract documents</Label>
        <div
          className='flex flex-wrap gap-1.5'
          data-testid='uat-contract-documents'
        >
          {documentIds.length === 0 && (
            <span className='text-xs text-muted-foreground'>
              Add the conditions of contract (a text PDF or Word file already in
              the project) so clauses can be read from it.
            </span>
          )}
          {documentIds.map((id) => (
            <span
              key={id}
              className='inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs'
            >
              <FileText className='h-3 w-3' />
              {titles[id] ?? `${id.slice(0, 8)}…`}
              {canEdit && (
                <button
                  type='button'
                  aria-label='Remove document'
                  onClick={() =>
                    setDocumentIds((previous) =>
                      previous.filter((value) => value !== id)
                    )
                  }
                >
                  <X className='h-3 w-3' />
                </button>
              )}
            </span>
          ))}
        </div>
        {canEdit && (
          <div className='space-y-1'>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search project documents by name or content…'
              data-testid='uat-contract-doc-search'
            />
            {query.trim().length >= 2 && (
              <ul className='divide-y rounded border text-xs'>
                {(search?.items ?? []).filter(
                  (hit) => !documentIds.includes(hit.documentId)
                ).length === 0 ? (
                  <li className='px-2 py-1.5 text-muted-foreground'>
                    No other matching documents.
                  </li>
                ) : (
                  (search?.items ?? [])
                    .filter((hit) => !documentIds.includes(hit.documentId))
                    .map((hit) => (
                      <li
                        key={hit.documentId}
                        className='flex items-center gap-2 px-2 py-1.5'
                      >
                        <span className='min-w-0 flex-1 truncate'>
                          {hit.title}
                          <span className='text-muted-foreground'>
                            {' '}
                            · {hit.fileName}
                          </span>
                        </span>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-6 px-2'
                          onClick={() => {
                            setDocumentIds((previous) => [
                              ...previous,
                              hit.documentId,
                            ])
                            setTitles((previous) => ({
                              ...previous,
                              [hit.documentId]: hit.title,
                            }))
                            setQuery('')
                          }}
                          data-testid='uat-contract-doc-add'
                        >
                          <Plus className='mr-1 h-3 w-3' /> Add
                        </Button>
                      </li>
                    ))
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {extraction && (
        <Alert data-testid='uat-contract-extracted'>
          <Sparkles className='h-4 w-4' />
          <AlertTitle>
            {extraction.proposed} clause{extraction.proposed === 1 ? '' : 's'}{' '}
            proposed
            {extraction.degraded ? ' from a text scan' : ''}
          </AlertTitle>
          <AlertDescription>
            {extraction.reason ??
              `${extraction.windowsRead} window${extraction.windowsRead === 1 ? '' : 's'} of text read. Review them in the clauses list and confirm the ones that are right.`}
            {Object.values(extraction.suggested).some(
              (value) => value !== null
            ) && (
              <Button
                size='sm'
                variant='outline'
                className='mt-2 h-7'
                onClick={() =>
                  setPeriods((previous) => ({
                    ...previous,
                    ...(extraction.suggested.delayNoticeDays !== null
                      ? {
                          delayNoticeDays: String(
                            extraction.suggested.delayNoticeDays
                          ),
                        }
                      : {}),
                    ...(extraction.suggested.variationNoticeDays !== null
                      ? {
                          variationNoticeDays: String(
                            extraction.suggested.variationNoticeDays
                          ),
                        }
                      : {}),
                    ...(extraction.suggested.paymentDays !== null
                      ? {
                          paymentDays: String(extraction.suggested.paymentDays),
                        }
                      : {}),
                    ...(extraction.suggested.defectsLiabilityDays !== null
                      ? {
                          defectsLiabilityDays: String(
                            extraction.suggested.defectsLiabilityDays
                          ),
                        }
                      : {}),
                  }))
                }
                data-testid='uat-contract-apply-periods'
              >
                Use the periods found in the documents
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {canEdit && (
        <div className='flex flex-wrap justify-end gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={extract.isPending || documentIds.length === 0}
            onClick={runExtract}
            data-testid='uat-contract-extract'
          >
            {extract.isPending ? (
              <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
            ) : (
              <Sparkles className='mr-1.5 h-4 w-4' />
            )}
            Read clauses from the documents
          </Button>
          <Button
            size='sm'
            disabled={update.isPending}
            onClick={save}
            data-testid='uat-contract-save'
          >
            {update.isPending && (
              <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
            )}
            Save profile
          </Button>
        </div>
      )}
    </section>
  )
}

function ClausesCard({
  projectId,
  profile,
  canEdit,
}: {
  projectId: string
  profile: ContractProfile
  canEdit: boolean
}) {
  const update = useUpdateContractProfile(projectId)
  const drafts = profile.clauses.filter((clause) => clause.status === 'draft')

  const setClauses = async (clauses: ContractClause[], message: string) => {
    try {
      await update.mutateAsync({ clauses })
      toast.success(message)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const setStatus = (id: string, status: ContractClause['status']) =>
    setClauses(
      profile.clauses.map((clause) =>
        clause.id === id ? { ...clause, status } : clause
      ),
      status === 'confirmed' ? 'Clause confirmed' : 'Clause rejected'
    )

  return (
    <section
      className='space-y-2 rounded-md border bg-card p-3'
      data-testid='uat-contract-clauses'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <h4 className='text-sm font-semibold'>Clauses on record</h4>
        <span className='text-xs text-muted-foreground'>
          {profile.clauses.length === 0
            ? 'None yet — read them from the documents or add them by hand.'
            : `${profile.clauses.filter((clause) => clause.status === 'confirmed').length} confirmed · ${drafts.length} to review`}
        </span>
        {canEdit && drafts.length > 0 && (
          <Button
            size='sm'
            variant='outline'
            className='ml-auto h-7'
            disabled={update.isPending}
            onClick={() =>
              update
                .mutateAsync({ confirm: true })
                .then(() => toast.success('All draft clauses confirmed'))
                .catch((error) => toast.error(getServerErrorMessage(error)))
            }
            data-testid='uat-contract-confirm-all'
          >
            <Check className='mr-1 h-3 w-3' /> Confirm all drafts
          </Button>
        )}
      </div>
      {profile.clauses.length > 0 && (
        <div className='overflow-x-auto rounded border'>
          <table className='w-full text-xs'>
            <thead className='bg-muted/50 text-muted-foreground'>
              <tr>
                <th className='px-2 py-1.5 text-left font-medium'>Category</th>
                <th className='px-2 py-1.5 text-left font-medium'>Reference</th>
                <th className='px-2 py-1.5 text-left font-medium'>Clause</th>
                <th className='px-2 py-1.5 text-right font-medium'>Days</th>
                <th className='px-2 py-1.5 text-left font-medium'>Status</th>
                {canEdit && <th className='px-2 py-1.5' />}
              </tr>
            </thead>
            <tbody>
              {profile.clauses.map((clause) => (
                <tr
                  key={clause.id}
                  className={cn(
                    'border-t align-top',
                    clause.status === 'rejected' && 'opacity-50'
                  )}
                  data-testid='uat-contract-clause'
                >
                  <td className='px-2 py-1.5'>
                    <Badge variant='outline' className='text-[10px]'>
                      {CATEGORY_LABEL[clause.category]}
                    </Badge>
                  </td>
                  <td className='px-2 py-1.5 font-mono whitespace-nowrap'>
                    {clause.reference ?? '—'}
                  </td>
                  <td className='px-2 py-1.5'>
                    <p className='font-medium'>{clause.title}</p>
                    {clause.summary && (
                      <p className='text-muted-foreground'>{clause.summary}</p>
                    )}
                    {clause.excerpt && (
                      <p className='mt-0.5 border-l-2 pl-2 text-muted-foreground italic'>
                        “{clause.excerpt}”
                      </p>
                    )}
                  </td>
                  <td className='px-2 py-1.5 text-right tabular-nums'>
                    {clause.days ?? '—'}
                  </td>
                  <td className='px-2 py-1.5'>
                    <Badge
                      variant={
                        clause.status === 'confirmed'
                          ? 'default'
                          : clause.status === 'draft'
                            ? 'secondary'
                            : 'outline'
                      }
                      className='text-[10px]'
                    >
                      {clause.status}
                      {clause.source === 'heuristic' ? ' · scan' : ''}
                    </Badge>
                  </td>
                  {canEdit && (
                    <td className='px-2 py-1.5 whitespace-nowrap'>
                      {clause.status !== 'confirmed' && (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-6 px-1.5'
                          onClick={() => setStatus(clause.id, 'confirmed')}
                          aria-label='Confirm clause'
                          data-testid='uat-contract-clause-confirm'
                        >
                          <Check className='h-3 w-3' />
                        </Button>
                      )}
                      {clause.status !== 'rejected' && (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-6 px-1.5'
                          onClick={() => setStatus(clause.id, 'rejected')}
                          aria-label='Reject clause'
                        >
                          <X className='h-3 w-3' />
                        </Button>
                      )}
                      <Button
                        size='sm'
                        variant='ghost'
                        className='h-6 px-1.5 text-destructive'
                        onClick={() =>
                          setClauses(
                            profile.clauses.filter(
                              (item) => item.id !== clause.id
                            ),
                            'Clause removed'
                          )
                        }
                        aria-label='Remove clause'
                      >
                        <Trash2 className='h-3 w-3' />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function NoticeDialog({
  projectId,
  item,
  onClose,
}: {
  projectId: string
  item: NoticeItem
  onClose: () => void
}) {
  const draft = useDraftNotice(projectId)
  const create = useCreateNotice(projectId)
  const [instructions, setInstructions] = useState('')
  const [result, setResult] = useState<NoticeDraft | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const runDraft = async () => {
    try {
      const drafted = await draft.mutateAsync({
        recordType: item.recordType,
        recordId: item.recordId,
        instructions: instructions.trim() || null,
      })
      setResult(drafted)
      setSubject(drafted.draft.subject)
      setBody(drafted.draft.body)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const send = async () => {
    try {
      const created = await create.mutateAsync({
        recordType: item.recordType,
        recordId: item.recordId,
        subject: subject.trim(),
        body: body.trim(),
        activityId: item.activityIds[0] ?? null,
      })
      toast.success(
        `${created.correspondence.ref} created as an outgoing notice${created.linked ? ' and linked to the event' : ''}`
      )
      onClose()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-contract-notice-dialog'
      >
        <DialogHeader>
          <DialogTitle>
            Notice for {item.ref ? `${item.ref} — ` : ''}
            {item.title}
          </DialogTitle>
          <DialogDescription>
            {item.periodDays} day period
            {item.clauseReference ? ` under ${item.clauseReference}` : ''} ·
            deadline {formatDate(item.deadline)} (
            {item.daysLeft >= 0
              ? `${item.daysLeft} days left`
              : `${Math.abs(item.daysLeft)} days ago`}
            ). The notice is created as an outgoing contractual correspondence
            only when you send it.
          </DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className='space-y-2'>
            <Label htmlFor='notice-instructions'>
              Anything the letter must say (optional)
            </Label>
            <Input
              id='notice-instructions'
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder='e.g. refer to the geotechnical report of 12 August'
              maxLength={1000}
            />
          </div>
        ) : (
          <div className='space-y-2'>
            {result.degraded && (
              <p className='text-xs text-muted-foreground'>{result.reason}</p>
            )}
            <div className='space-y-1'>
              <Label htmlFor='notice-subject'>Subject</Label>
              <Input
                id='notice-subject'
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
                data-testid='uat-contract-notice-subject'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='notice-body'>Letter</Label>
              <Textarea
                id='notice-body'
                rows={12}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                data-testid='uat-contract-notice-body'
              />
            </div>
            {result.draft.clauseRefs.length > 0 && (
              <p className='text-xs text-muted-foreground'>
                Cites: {result.draft.clauseRefs.join(', ')}
              </p>
            )}
            <AiRunFeedback
              projectId={projectId}
              messageId={result.message?.id ?? null}
              initial={result.message?.feedback ?? null}
              model={result.message?.model}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          {!result ? (
            <Button
              disabled={draft.isPending}
              onClick={runDraft}
              data-testid='uat-contract-notice-draft'
            >
              {draft.isPending ? (
                <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
              ) : (
                <Sparkles className='mr-1.5 h-4 w-4' />
              )}
              Draft the notice
            </Button>
          ) : (
            <Button
              disabled={create.isPending || !subject.trim() || !body.trim()}
              onClick={send}
              data-testid='uat-contract-notice-create'
            >
              {create.isPending && (
                <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
              )}
              Create as outgoing notice
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NoticesCard({
  projectId,
  canDraft,
}: {
  projectId: string
  canDraft: boolean
}) {
  const { data: monitor, isLoading } = useNoticeMonitor(projectId)
  const [target, setTarget] = useState<NoticeItem | null>(null)
  if (isLoading || !monitor) {
    return <p className='text-sm text-muted-foreground'>Checking notices…</p>
  }
  const chips: Array<[NoticeStatus | 'dueSoon', string, number]> = [
    ['missed', 'Missed', monitor.summary.missed],
    ['dueSoon', 'Due within 7 days', monitor.summary.dueSoon],
    ['due', 'Due', monitor.summary.due],
    ['late', 'Served late', monitor.summary.late],
    ['served', 'Served', monitor.summary.served],
  ]
  return (
    <section
      className='space-y-2 rounded-md border bg-card p-3'
      data-testid='uat-contract-notices'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <h4 className='text-sm font-semibold'>Notice monitor</h4>
        <span className='text-xs text-muted-foreground'>
          Delay events, variations, RFIs with a schedule impact, EOT claims and
          incoming notices against the {monitor.profile.formLabel} periods (
          {monitor.profile.delayNoticeDays} /{' '}
          {monitor.profile.variationNoticeDays} / {monitor.profile.responseDays}{' '}
          days).
        </span>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {chips.map(([key, label, value]) => (
          <Badge
            key={key}
            variant={
              key === 'missed' && value > 0
                ? 'destructive'
                : (key === 'dueSoon' || key === 'due' || key === 'late') &&
                    value > 0
                  ? 'secondary'
                  : 'outline'
            }
            data-testid={`uat-contract-notice-${key}`}
          >
            {label}: {value}
          </Badge>
        ))}
      </div>
      {monitor.items.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          No event on record needs a notice.
        </p>
      ) : (
        <div className='overflow-x-auto rounded border'>
          <table className='w-full text-xs'>
            <thead className='bg-muted/50 text-muted-foreground'>
              <tr>
                <th className='px-2 py-1.5 text-left font-medium'>Event</th>
                <th className='px-2 py-1.5 text-left font-medium'>Date</th>
                <th className='px-2 py-1.5 text-left font-medium'>Period</th>
                <th className='px-2 py-1.5 text-left font-medium'>Deadline</th>
                <th className='px-2 py-1.5 text-left font-medium'>Status</th>
                <th className='px-2 py-1.5 text-left font-medium'>Served by</th>
                <th className='px-2 py-1.5' />
              </tr>
            </thead>
            <tbody>
              {monitor.items.map((item) => {
                const link = workspaceLink(item.url)
                return (
                  <tr
                    key={`${item.recordType}:${item.recordId}`}
                    className='border-t'
                    data-testid='uat-contract-notice-row'
                  >
                    <td className='px-2 py-1.5'>
                      <span className='block text-[10px] text-muted-foreground uppercase'>
                        {KIND_LABEL[item.kind]}
                      </span>
                      {link ? (
                        <Link
                          to='/projects/$projectId'
                          params={{ projectId: link.projectId }}
                          search={link.search}
                          className='font-medium underline-offset-2 hover:underline'
                        >
                          {item.ref ? `${item.ref} · ` : ''}
                          {item.title}
                        </Link>
                      ) : (
                        <span className='font-medium'>
                          {item.ref ? `${item.ref} · ` : ''}
                          {item.title}
                        </span>
                      )}
                    </td>
                    <td className='px-2 py-1.5 whitespace-nowrap'>
                      {formatDate(item.date)}
                    </td>
                    <td className='px-2 py-1.5 whitespace-nowrap'>
                      {item.periodDays} d
                      {item.clauseReference ? (
                        <span className='block text-muted-foreground'>
                          {item.clauseReference}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        'px-2 py-1.5 whitespace-nowrap',
                        item.status === 'due' &&
                          item.daysLeft <= 7 &&
                          'text-amber-600 dark:text-amber-400',
                        item.status === 'missed' && 'text-destructive'
                      )}
                    >
                      {formatDate(item.deadline)}
                      {item.status === 'due' ? (
                        <span className='block'>
                          {item.daysLeft} day{item.daysLeft === 1 ? '' : 's'}{' '}
                          left
                        </span>
                      ) : null}
                    </td>
                    <td className='px-2 py-1.5'>
                      <Badge
                        variant={statusVariant(item.status)}
                        className='text-[10px]'
                      >
                        {STATUS_LABEL[item.status]}
                      </Badge>
                    </td>
                    <td className='px-2 py-1.5'>
                      {item.served
                        ? `${item.served.ref ?? item.served.subject ?? 'notice'} · ${formatDate(item.served.date)}${item.served.lateByDays ? ` (${item.served.lateByDays} d late)` : ''}`
                        : '—'}
                    </td>
                    <td className='px-2 py-1.5 whitespace-nowrap'>
                      {canDraft &&
                        item.kind !== 'incoming_notice' &&
                        (item.status === 'due' || item.status === 'missed') && (
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-6 px-2'
                            onClick={() => setTarget(item)}
                            data-testid='uat-contract-notice-open'
                          >
                            <Sparkles className='mr-1 h-3 w-3' /> Draft notice
                          </Button>
                        )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <NoticeDialog
          projectId={projectId}
          item={target}
          onClose={() => setTarget(null)}
        />
      )}
    </section>
  )
}

/**
 * Commercial › Contract: the contract profile (form, periods, documents),
 * the clauses read from the documents and confirmed by a person, and the
 * notice monitor with drafted notices.
 */
export function ContractPanel({ projectId }: { projectId: string }) {
  const { data: profile, isLoading } = useContractProfile(projectId)
  const canEdit = useCanPerform('eot', 'update')
  const canDraft = useCanPerform('document_control', 'create')
  if (isLoading || !profile) {
    return (
      <div className='flex items-center gap-2 py-8 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading the contract…
      </div>
    )
  }
  return (
    <div className='space-y-3' data-testid='uat-contract'>
      {!profile.exists && (
        <Alert>
          <AlertTriangle className='h-4 w-4' />
          <AlertTitle>Set the contract up once</AlertTitle>
          <AlertDescription>
            Pick the form of contract, check the notice periods, add the
            conditions of contract and read the clauses from them. The notice
            monitor and the EOT assessments use these.
          </AlertDescription>
        </Alert>
      )}
      <ProfileCard
        key={profile.updatedAt ?? 'new'}
        projectId={projectId}
        profile={profile}
        canEdit={canEdit}
      />
      <ClausesCard projectId={projectId} profile={profile} canEdit={canEdit} />
      <NoticesCard projectId={projectId} canDraft={canDraft} />
    </div>
  )
}
