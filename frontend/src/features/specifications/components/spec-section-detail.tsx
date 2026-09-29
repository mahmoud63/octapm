import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  MessageSquarePlus,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import {
  useCheckSpecConflicts,
  useSpecSection,
  useSpecStatus,
  type SpecBasis,
  type SpecConflictResult,
  type SpecRelated,
} from '../hooks/use-specifications'
import { RaiseSpecRfiDialog } from './raise-rfi-dialog'

const BASIS_LABEL: Record<SpecBasis, string> = {
  code: 'same code',
  title: 'title keywords',
  division: 'division vocabulary',
  discipline: 'same discipline',
  spec_section: 'cites the section',
}

const SEVERITY_CLASS: Record<string, string> = {
  high: 'border-rose-300 text-rose-700 dark:text-rose-300',
  medium: 'border-amber-300 text-amber-700 dark:text-amber-300',
  low: 'border-emerald-300 text-emerald-700 dark:text-emerald-300',
}

function RecordLink({
  path,
  children,
  className,
}: {
  path: string | null
  children: React.ReactNode
  className?: string
}) {
  const link = workspaceLink(path)
  if (!link) return <span className={className}>{children}</span>
  return (
    <Link
      to='/projects/$projectId'
      params={{ projectId: link.projectId }}
      search={link.search}
      className={cn('underline-offset-2 hover:underline', className)}
    >
      {children}
    </Link>
  )
}

function BasisBadge({ basis }: { basis: SpecBasis }) {
  return (
    <Badge
      variant='outline'
      className='px-1 py-0 text-[10px] font-normal text-muted-foreground'
      title='Why this record relates to the section'
    >
      {BASIS_LABEL[basis]}
    </Badge>
  )
}

function RelatedLists({ related }: { related: SpecRelated }) {
  const blocks: Array<{
    key: string
    label: string
    empty: string
    items: React.ReactNode[]
    /** Withheld by the server: no count is shown, only its reason. */
    withheld?: boolean
  }> = [
    {
      key: 'boq',
      label: 'BOQ items',
      withheld: Boolean(related.boqItemsWithheld),
      empty: related.boqItemsWithheld
        ? `— ${related.boqItemsWithheld.reason}`
        : 'No BOQ item matches this section — a pricing gap or a naming mismatch.',
      items: (related.boqItems ?? []).slice(0, 12).map((item) => (
        <li key={item.id} className='flex flex-wrap items-baseline gap-1'>
          <span className='font-mono text-xs'>{item.code ?? '—'}</span>
          <span className='min-w-0 flex-1'>{item.description}</span>
          <span className='text-xs text-muted-foreground'>
            {item.qty} {item.unit ?? ''}
          </span>
          <BasisBadge basis={item.basis} />
        </li>
      )),
    },
    {
      key: 'sheets',
      label: 'Drawings',
      empty: 'No sheet relates to this section.',
      items: related.sheets.slice(0, 12).map((sheet) => (
        <li key={sheet.id} className='flex flex-wrap items-baseline gap-1'>
          <RecordLink path={sheet.path} className='font-mono text-xs'>
            {sheet.number}
          </RecordLink>
          <span className='min-w-0 flex-1'>{sheet.title}</span>
          <BasisBadge basis={sheet.basis} />
        </li>
      )),
    },
    {
      key: 'activities',
      label: 'Schedule activities',
      empty: 'No activity relates to this section.',
      items: related.activities.slice(0, 12).map((activity) => (
        <li key={activity.id} className='flex flex-wrap items-baseline gap-1'>
          {activity.activityCode && (
            <span className='font-mono text-xs'>{activity.activityCode}</span>
          )}
          <span className='min-w-0 flex-1'>{activity.name}</span>
          <BasisBadge basis={activity.basis} />
        </li>
      )),
    },
    {
      key: 'rfis',
      label: 'RFIs',
      empty: 'No RFI on this section.',
      items: related.rfis.slice(0, 12).map((rfi) => (
        <li key={rfi.id} className='flex flex-wrap items-baseline gap-1'>
          <RecordLink path={rfi.path} className='font-mono text-xs'>
            {rfi.ref}
          </RecordLink>
          <span className='min-w-0 flex-1'>{rfi.subject}</span>
          <Badge variant='outline' className='px-1 py-0 text-[10px]'>
            {rfi.status}
          </Badge>
          <BasisBadge basis={rfi.basis} />
        </li>
      )),
    },
  ]
  return (
    <div className='grid gap-3 md:grid-cols-2' data-testid='uat-spec-related'>
      {blocks.map((block) => (
        <div key={block.key} className='rounded-md border p-3 text-sm'>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>
            {block.label} · {block.withheld ? '—' : block.items.length}
          </p>
          {block.items.length ? (
            <ul className='space-y-1'>{block.items}</ul>
          ) : (
            <p
              className='text-xs text-muted-foreground'
              data-testid={
                block.withheld
                  ? `uat-spec-related-${block.key}-withheld`
                  : undefined
              }
            >
              {block.empty}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function ConflictCheck({
  projectId,
  sectionId,
  sectionCode,
  related,
}: {
  projectId: string
  sectionId: string
  sectionCode: string
  related: SpecRelated
}) {
  const { data: status } = useSpecStatus(projectId)
  const canAsk = useCanPerform('assistant', 'read')
  const canRaise = useCanPerform('rfi', 'create')
  const check = useCheckSpecConflicts(projectId)
  const sheetLimit = status?.sheetLimit ?? 6
  const candidates = useMemo(
    () => related.sheets.filter((sheet) => sheet.currentRevisionId),
    [related.sheets]
  )
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [result, setResult] = useState<SpecConflictResult | null>(null)
  const [rfiSeed, setRfiSeed] = useState<{
    subject: string
    question: string
    priority?: string
  } | null>(null)
  const [rfiOpen, setRfiOpen] = useState(false)

  const chosen =
    selected ??
    new Set(candidates.slice(0, sheetLimit).map((sheet) => sheet.id))

  if (!canAsk) return null
  if (!status?.enabled) {
    return (
      <p className='rounded-md border border-dashed p-3 text-xs text-muted-foreground'>
        No AI provider is configured — the spec-vs-drawing check is not
        available. The related records above are computed without it.
      </p>
    )
  }

  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else if (next.size < sheetLimit) next.add(id)
    else toast.info(`Up to ${sheetLimit} sheets per check`)
    setSelected(next)
  }

  const run = async () => {
    try {
      const value = await check.mutateAsync({
        sectionId,
        sheetIds: [...chosen],
      })
      if (value.degraded)
        toast.error(value.reason || 'The assistant is not available')
      setResult(value)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const raiseFrom = (conflict: {
    topic: string
    specSays: string | null
    drawingSays: string | null
    sheetNumber: string | null
    severity: string
    recommendation: string | null
  }) => {
    setRfiSeed({
      subject: `${sectionCode} — ${conflict.topic}${conflict.sheetNumber ? ` (${conflict.sheetNumber})` : ''}`,
      question: [
        `Specification section ${sectionCode} states: ${conflict.specSays ?? '—'}`,
        `Drawing ${conflict.sheetNumber ?? ''} shows: ${conflict.drawingSays ?? '—'}`,
        '',
        'Please confirm which applies.',
        conflict.recommendation ? `Suggested: ${conflict.recommendation}` : '',
      ]
        .filter((line, index, all) => line !== '' || index < all.length - 1)
        .join('\n'),
      priority: conflict.severity === 'high' ? 'high' : 'normal',
    })
    setRfiOpen(true)
  }

  return (
    <div className='space-y-3' data-testid='uat-spec-conflicts'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          disabled={check.isPending}
          onClick={run}
          data-testid='uat-spec-conflicts-run'
        >
          {check.isPending ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <Sparkles className='mr-2 h-4 w-4' />
          )}
          {result ? 'Check again' : 'Check against drawings'}
        </Button>
        <span className='text-xs text-muted-foreground'>
          {candidates.length
            ? `Reads the text layer of ${chosen.size} sheet${chosen.size === 1 ? '' : 's'} (max ${sheetLimit}) and this section, and lists conflicts and gaps. Proposals only — check the sheet.`
            : 'No related sheet has a revision with a file; the check will report specification-side observations only.'}
        </span>
      </div>
      {candidates.length > 0 && (
        <div className='flex flex-wrap gap-2 text-xs'>
          {candidates.slice(0, 24).map((sheet) => (
            <label
              key={sheet.id}
              className='inline-flex items-center gap-1 rounded border px-2 py-0.5'
              title={`${sheet.title} · ${BASIS_LABEL[sheet.basis]}`}
            >
              <Checkbox
                checked={chosen.has(sheet.id)}
                onCheckedChange={() => toggle(sheet.id)}
              />
              <span className='font-mono'>{sheet.number}</span>
            </label>
          ))}
        </div>
      )}
      {result?.result && (
        <div className='space-y-3 rounded-md border p-3 text-sm'>
          <div className='flex flex-wrap items-start gap-2'>
            <p className='min-w-0 flex-1'>{result.result.summary}</p>
            <Badge variant='outline'>
              {result.result.confidence} confidence
            </Badge>
          </div>
          <p className='text-xs text-muted-foreground'>
            Checked:{' '}
            {result.sheetsChecked.length
              ? result.sheetsChecked
                  .map(
                    (sheet) =>
                      `${sheet.number}${sheet.chars ? '' : ' (no text layer)'}`
                  )
                  .join(', ')
              : 'no sheets'}
          </p>
          {result.result.conflicts.length > 0 ? (
            <ul className='space-y-2' data-testid='uat-spec-conflict-list'>
              {result.result.conflicts.map((conflict, index) => (
                <li key={index} className='rounded border p-2'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <AlertTriangle className='h-4 w-4 text-amber-600' />
                    <span className='font-medium'>{conflict.topic}</span>
                    <Badge
                      variant='outline'
                      className={cn(
                        'text-[10px]',
                        SEVERITY_CLASS[conflict.severity]
                      )}
                    >
                      {conflict.severity}
                    </Badge>
                    {conflict.sheetNumber && (
                      <span className='font-mono text-xs'>
                        {conflict.sheetNumber}
                      </span>
                    )}
                    {canRaise && (
                      <Button
                        size='sm'
                        variant='outline'
                        className='ml-auto h-7'
                        onClick={() => raiseFrom(conflict)}
                        data-testid='uat-spec-conflict-rfi'
                      >
                        <MessageSquarePlus className='mr-1 h-3.5 w-3.5' /> Raise
                        RFI
                      </Button>
                    )}
                  </div>
                  <dl className='mt-1 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[110px_1fr]'>
                    <dt className='text-muted-foreground'>Specification</dt>
                    <dd>{conflict.specSays ?? '—'}</dd>
                    <dt className='text-muted-foreground'>Drawing</dt>
                    <dd>{conflict.drawingSays ?? '—'}</dd>
                    {conflict.recommendation && (
                      <>
                        <dt className='text-muted-foreground'>Suggested</dt>
                        <dd>{conflict.recommendation}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-muted-foreground'>
              No conflict was found in the text that was checked.
            </p>
          )}
          {result.result.gaps.length > 0 && (
            <div>
              <p className='mb-1 text-xs font-medium text-muted-foreground'>
                Gaps
              </p>
              <ul className='space-y-1 text-xs'>
                {result.result.gaps.map((gap, index) => (
                  <li
                    key={index}
                    className='flex flex-wrap items-baseline gap-1'
                  >
                    <Badge variant='outline' className='px-1 py-0 text-[10px]'>
                      {gap.where === 'drawings'
                        ? 'missing on drawings'
                        : 'missing in spec'}
                    </Badge>
                    <span className='font-medium'>{gap.topic}</span>
                    {gap.detail && (
                      <span className='text-muted-foreground'>
                        — {gap.detail}
                      </span>
                    )}
                    {canRaise && (
                      <button
                        type='button'
                        className='text-primary underline-offset-2 hover:underline'
                        onClick={() =>
                          raiseFrom({
                            topic: gap.topic,
                            specSays:
                              gap.where === 'drawings' ? gap.detail : null,
                            drawingSays:
                              gap.where === 'specification' ? gap.detail : null,
                            sheetNumber: null,
                            severity: 'medium',
                            recommendation: null,
                          })
                        }
                      >
                        Raise RFI
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.message && (
            <AiRunFeedback
              projectId={projectId}
              messageId={result.message.id}
              initial={result.message.feedback}
              model={result.message.model}
            />
          )}
        </div>
      )}
      <RaiseSpecRfiDialog
        projectId={projectId}
        sectionId={sectionId}
        sectionCode={sectionCode}
        initial={rfiSeed}
        open={rfiOpen}
        onOpenChange={setRfiOpen}
      />
    </div>
  )
}

/** One section: heading, text, what it relates to, and the conflict check. */
export function SpecSectionDetail({
  projectId,
  sectionId,
}: {
  projectId: string
  sectionId: string
}) {
  const {
    data: section,
    isLoading,
    isError,
    error,
  } = useSpecSection(projectId, sectionId)
  const [textOpen, setTextOpen] = useState(false)

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading section…
      </div>
    )
  }
  if (isError || !section) {
    return (
      <p className='p-4 text-sm text-destructive'>
        {error ? getServerErrorMessage(error) : 'Section not found'}
      </p>
    )
  }

  return (
    <div className='space-y-3' data-testid='uat-spec-section'>
      <div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-mono text-lg font-semibold'>
            {section.code}
          </span>
          <span className='text-lg font-medium'>{section.title}</span>
          {section.divisionLabel && (
            <Badge variant='secondary'>
              Division {section.division} · {section.divisionLabel}
            </Badge>
          )}
        </div>
        <p className='text-xs text-muted-foreground'>
          {[
            section.document?.title,
            section.pageFrom
              ? `pages ${section.pageFrom}${section.pageTo && section.pageTo !== section.pageFrom ? `–${section.pageTo}` : ''}`
              : null,
            `${section.wordCount} words`,
            section.related.keywords.length
              ? `keywords: ${section.related.keywords.join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <div className='rounded-md border'>
        <button
          type='button'
          className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm'
          onClick={() => setTextOpen((value) => !value)}
          data-testid='uat-spec-text-toggle'
        >
          <FileText className='h-4 w-4' />
          Section text
          {textOpen ? (
            <ChevronUp className='ml-auto h-4 w-4' />
          ) : (
            <ChevronDown className='ml-auto h-4 w-4' />
          )}
        </button>
        {textOpen && (
          <pre className='max-h-[50vh] overflow-auto border-t px-3 py-2 font-sans text-xs whitespace-pre-wrap'>
            {section.text}
            {section.truncated ? '\n[…]' : ''}
          </pre>
        )}
      </div>

      <RelatedLists related={section.related} />

      <ConflictCheck
        projectId={projectId}
        sectionId={section.id}
        sectionCode={section.code}
        related={section.related}
      />
    </div>
  )
}
