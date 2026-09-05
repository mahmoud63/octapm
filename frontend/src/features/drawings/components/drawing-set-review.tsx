import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBuildSetReferences } from '../hooks/use-drawing-assistant'
import {
  useDeleteDrawingSet,
  useDrawingSet,
  usePublishDrawingSet,
  useReprocessDrawingSet,
  useReviewRevisions,
  useUpdateDrawingSet,
  formatBytes,
  type RevisionReviewUpdate,
  type SheetRevision,
} from '../hooks/use-drawings'
import { SheetThumbnail } from './sheet-thumbnail'
import { TitleBlockReader } from './title-block-reader'

type Draft = {
  number: string
  title: string
  revision: string
  discipline: string
  rejected: boolean
}

const draftFor = (row: SheetRevision): Draft => ({
  number: row.number ?? '',
  title: row.title ?? '',
  revision: row.revision ?? '',
  discipline: row.discipline ?? '',
  rejected: row.status === 'rejected',
})

const isDirty = (row: SheetRevision, draft: Draft) =>
  draft.number !== (row.number ?? '') ||
  draft.title !== (row.title ?? '') ||
  draft.revision !== (row.revision ?? '') ||
  draft.discipline !== (row.discipline ?? '') ||
  draft.rejected !== (row.status === 'rejected')

const SET_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  processing: 'Processing',
  review: 'Ready for review',
  published: 'Published',
  archived: 'Archived',
  failed: 'Failed',
}

function ConfidenceBadge({
  value,
  textStatus,
}: {
  value: number
  textStatus: SheetRevision['textStatus']
}) {
  if (textStatus === 'no_text') {
    return (
      <Badge
        variant='outline'
        className='border-rose-300 text-rose-700 dark:text-rose-300'
        title='No text layer on this page — enter the details manually'
      >
        No text
      </Badge>
    )
  }
  const percent = Math.round(value * 100)
  const tone =
    value >= 0.8
      ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
      : value >= 0.5
        ? 'border-amber-300 text-amber-700 dark:text-amber-300'
        : 'border-rose-300 text-rose-700 dark:text-rose-300'
  return (
    <Badge
      variant='outline'
      className={tone}
      title='How sure the title-block reader is about number and title'
    >
      {percent}%
    </Badge>
  )
}

const revisionStatusLabel = (status: SheetRevision['status']) =>
  ({
    pending_review: 'Pending',
    published: 'Published',
    superseded: 'Superseded',
    rejected: 'Rejected',
  })[status]

/**
 * Review grid for one set: every page with its detected number / title /
 * revision / discipline and confidence, editable inline. Publish sends the
 * reviewed pages to their sheets.
 */
export function DrawingSetReview({
  projectId,
  setId,
  onBack,
  onOpenSheet,
}: {
  projectId: string
  setId: string
  onBack: () => void
  onOpenSheet: (sheetId: string) => void
}) {
  const { data: set, isLoading } = useDrawingSet(projectId, setId)
  const canReview = useCanPerform(
    'document_control',
    'submit',
    'document.revision.upload'
  )
  const canPublish = useCanPerform(
    'document_control',
    'update',
    'drawing.publish'
  )
  const canManage = useCanPerform('document_control', 'update')
  const review = useReviewRevisions(projectId, setId)
  const publish = usePublishDrawingSet(projectId)
  const reprocess = useReprocessDrawingSet(projectId)
  const updateSet = useUpdateDrawingSet(projectId)
  const deleteSet = useDeleteDrawingSet(projectId)
  const buildReferences = useBuildSetReferences(projectId)
  // Only the rows the user edited are kept in state; everything else shows
  // the server values, so a background refresh never overwrites an edit.
  const [overrides, setOverrides] = useState<Record<string, Draft>>({})
  const [filter, setFilter] = useState<
    'all' | 'needs_review' | 'pending' | 'published'
  >('all')

  const revisions = useMemo(() => set?.revisions ?? [], [set?.revisions])
  const drafts = useMemo(() => {
    const next: Record<string, Draft> = {}
    for (const row of revisions) {
      const edited = overrides[row.id]
      next[row.id] = edited && isDirty(row, edited) ? edited : draftFor(row)
    }
    return next
  }, [overrides, revisions])

  const dirtyRows = useMemo(
    () =>
      revisions.filter((row) => drafts[row.id] && isDirty(row, drafts[row.id])),
    [drafts, revisions]
  )
  const visible = useMemo(
    () =>
      revisions.filter((row) => {
        if (filter === 'pending') return row.status === 'pending_review'
        if (filter === 'published')
          return row.status === 'published' || row.status === 'superseded'
        if (filter === 'needs_review')
          return (
            row.status === 'pending_review' &&
            (row.confidence < 0.8 || !row.number)
          )
        return true
      }),
    [filter, revisions]
  )
  const readyToPublish = revisions.filter(
    (row) => row.status === 'pending_review' && row.number?.trim()
  ).length
  const missingNumbers = revisions.filter(
    (row) => row.status === 'pending_review' && !row.number?.trim()
  ).length
  // Pages the automatic reader could not settle — worth a look by the
  // vision provider: no text layer first, then missing numbers, then
  // low confidence.
  const aiCandidates = useMemo(
    () =>
      revisions
        .filter(
          (row) =>
            row.status === 'pending_review' &&
            (row.textStatus === 'no_text' ||
              !row.number?.trim() ||
              row.confidence < 0.8)
        )
        .sort(
          (a, b) =>
            Number(b.textStatus === 'no_text') -
              Number(a.textStatus === 'no_text') ||
            Number(!b.number) - Number(!a.number) ||
            a.confidence - b.confidence
        ),
    [revisions]
  )

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setOverrides((current) => ({
      ...current,
      [id]: { ...(current[id] ?? drafts[id]), ...patch },
    }))

  /** A vision proposal fills the empty fields of the draft; typed values stay. */
  const applyProposal = (
    id: string,
    proposal: {
      number: string | null
      title: string | null
      revision: string | null
      discipline: string | null
    }
  ) =>
    setOverrides((current) => {
      const draft = current[id] ?? drafts[id]
      if (!draft) return current
      return {
        ...current,
        [id]: {
          ...draft,
          number: draft.number.trim() || proposal.number || draft.number,
          title: draft.title.trim() || proposal.title || draft.title,
          revision:
            draft.revision.trim() || proposal.revision || draft.revision,
          discipline:
            draft.discipline.trim() || proposal.discipline || draft.discipline,
        },
      }
    })

  const save = async () => {
    if (!dirtyRows.length) return
    const updates: RevisionReviewUpdate[] = dirtyRows.map((row) => {
      const draft = drafts[row.id]
      return {
        id: row.id,
        number: draft.number.trim() || null,
        title: draft.title.trim() || null,
        revision: draft.revision.trim() || null,
        discipline: draft.discipline.trim() || null,
        status: draft.rejected ? 'rejected' : 'pending_review',
      }
    })
    try {
      await review.mutateAsync(updates)
      setOverrides({})
      toast.success(
        `${updates.length} page${updates.length === 1 ? '' : 's'} updated`
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const publishAll = async () => {
    if (dirtyRows.length) await save()
    try {
      const result = await publish.mutateAsync({ setId })
      toast.success(
        `${result.published} sheet${result.published === 1 ? '' : 's'} published` +
          (result.skipped ? ` · ${result.skipped} skipped (no number)` : '') +
          (result.results.some((row) => row.supersededRevisionId)
            ? ' · previous revisions superseded'
            : '')
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  if (isLoading || !set) {
    return (
      <div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading set…
      </div>
    )
  }

  const processing = set.status === 'processing'

  return (
    <div className='space-y-3' data-testid='uat-drawing-set-review'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button variant='ghost' size='sm' onClick={onBack}>
          <ArrowLeft className='mr-2 h-4 w-4' /> Sets
        </Button>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-mono font-semibold'>{set.setNumber}</span>
            <span className='truncate font-medium'>{set.name}</span>
            <Badge
              variant={set.status === 'failed' ? 'destructive' : 'outline'}
            >
              {SET_STATUS_LABEL[set.status] ?? set.status}
            </Badge>
            {set.purpose && (
              <Badge variant='secondary'>{set.purpose.replace('_', ' ')}</Badge>
            )}
          </div>
          <p className='text-xs text-muted-foreground'>
            {[
              set.fileName,
              set.sizeBytes ? formatBytes(set.sizeBytes) : null,
              set.pageCount ? `${set.pageCount} pages` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {set.detectionSummary
              ? ` · ${set.detectionSummary.detected} numbers read automatically, ${set.detectionSummary.needsReview} to check` +
                (set.detectionSummary.noText
                  ? `, ${set.detectionSummary.noText} without text`
                  : '')
              : ''}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-1'>
          {canManage && !processing && (
            <Button
              size='sm'
              variant='outline'
              disabled={reprocess.isPending}
              onClick={() =>
                reprocess.mutate(setId, {
                  onError: (error) => toast.error(getServerErrorMessage(error)),
                })
              }
            >
              <RefreshCw className='mr-2 h-4 w-4' /> Re-read title blocks
            </Button>
          )}
          {canReview && !processing && (
            <TitleBlockReader
              projectId={projectId}
              setId={setId}
              candidates={aiCandidates}
              onProposal={applyProposal}
            />
          )}
          {canReview &&
            !processing &&
            set.counts &&
            set.counts.published > 0 && (
              <Button
                size='sm'
                variant='outline'
                disabled={buildReferences.isPending}
                title='Read the sheet numbers and detail callouts on every published page and link the sheets to each other'
                onClick={() =>
                  buildReferences.mutate(setId, {
                    onSuccess: (result) =>
                      toast.success(
                        `${result.references} reference${result.references === 1 ? '' : 's'} across ${result.sheetsBuilt} sheet${result.sheetsBuilt === 1 ? '' : 's'}` +
                          (result.noText
                            ? ` · ${result.noText} page${result.noText === 1 ? '' : 's'} without text`
                            : '')
                      ),
                    onError: (error) =>
                      toast.error(getServerErrorMessage(error)),
                  })
                }
                data-testid='uat-drawing-ai-references'
              >
                {buildReferences.isPending ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <Link2 className='mr-2 h-4 w-4' />
                )}
                Link references
              </Button>
            )}
          {canManage && set.status !== 'archived' && !processing && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() =>
                updateSet.mutate(
                  { setId, status: 'archived' },
                  { onSuccess: onBack }
                )
              }
            >
              Archive
            </Button>
          )}
          {canManage &&
            set.counts &&
            set.counts.published === 0 &&
            set.counts.superseded === 0 &&
            !processing && (
              <Button
                size='sm'
                variant='ghost'
                className='text-destructive'
                onClick={() => {
                  if (
                    !window.confirm(
                      'Delete this set and its unpublished pages?'
                    )
                  )
                    return
                  deleteSet.mutate(setId, {
                    onSuccess: onBack,
                    onError: (error) =>
                      toast.error(getServerErrorMessage(error)),
                  })
                }}
              >
                <Trash2 className='mr-2 h-4 w-4' /> Delete
              </Button>
            )}
        </div>
      </div>

      {processing && (
        <div
          className='space-y-1 rounded-md border px-3 py-2 text-sm'
          data-testid='uat-drawing-set-progress'
        >
          <div className='flex items-center gap-2'>
            <Loader2 className='h-4 w-4 animate-spin' />
            Reading title blocks… {set.processedPages}/{set.pageCount ?? '?'}{' '}
            pages
          </div>
          <div className='h-1.5 overflow-hidden rounded bg-muted'>
            <div
              className='h-full bg-primary transition-all'
              style={{ width: `${set.progress}%` }}
            />
          </div>
        </div>
      )}
      {set.status === 'failed' && (
        <p className='rounded-md border border-destructive/40 p-3 text-sm text-destructive'>
          Processing failed: {set.error || 'unknown error'}. Check the file is
          an unencrypted PDF and try again.
        </p>
      )}

      {!processing && revisions.length > 0 && (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            {(['all', 'needs_review', 'pending', 'published'] as const).map(
              (value) => (
                <Button
                  key={value}
                  size='sm'
                  variant={filter === value ? 'default' : 'outline'}
                  onClick={() => setFilter(value)}
                >
                  {value === 'all'
                    ? `All (${revisions.length})`
                    : value === 'needs_review'
                      ? 'Needs a look'
                      : value === 'pending'
                        ? 'Pending'
                        : 'Published'}
                </Button>
              )
            )}
            <div className='ml-auto flex items-center gap-1'>
              {canReview && (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={!dirtyRows.length || review.isPending}
                  onClick={save}
                  data-testid='uat-drawing-set-save'
                >
                  <Save className='mr-2 h-4 w-4' /> Save{' '}
                  {dirtyRows.length ? `(${dirtyRows.length})` : ''}
                </Button>
              )}
              {canPublish && (
                <Button
                  size='sm'
                  disabled={!readyToPublish || publish.isPending}
                  onClick={publishAll}
                  title={
                    missingNumbers
                      ? `${missingNumbers} page(s) without a number will be skipped`
                      : undefined
                  }
                  data-testid='uat-drawing-set-publish'
                >
                  <Send className='mr-2 h-4 w-4' /> Publish {readyToPublish}{' '}
                  sheet{readyToPublish === 1 ? '' : 's'}
                </Button>
              )}
            </div>
          </div>

          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full min-w-[900px] text-sm'>
              <thead className='bg-muted/50 text-left text-xs text-muted-foreground uppercase'>
                <tr>
                  <th className='w-[110px] px-2 py-2'>Page</th>
                  <th className='w-[150px] px-2 py-2'>Number</th>
                  <th className='px-2 py-2'>Title</th>
                  <th className='w-[90px] px-2 py-2'>Rev</th>
                  <th className='w-[150px] px-2 py-2'>Discipline</th>
                  <th className='w-[90px] px-2 py-2'>Read</th>
                  <th className='w-[120px] px-2 py-2'>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const draft = drafts[row.id] ?? draftFor(row)
                  const editable =
                    canReview &&
                    (row.status === 'pending_review' ||
                      row.status === 'rejected')
                  const dirty = isDirty(row, draft)
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-t align-top',
                        dirty && 'bg-amber-50/60 dark:bg-amber-500/5',
                        draft.rejected && 'opacity-60'
                      )}
                      data-testid='uat-drawing-set-row'
                    >
                      <td className='px-2 py-2'>
                        <div className='space-y-1'>
                          <SheetThumbnail
                            fileUrl={row.fileUrl}
                            pageNumber={row.pageNumber}
                            rotation={row.rotation}
                            width={96}
                            aspect={
                              row.width && row.height
                                ? row.height / row.width
                                : 0.7
                            }
                          />
                          <div className='text-xs text-muted-foreground'>
                            p. {row.pageNumber}
                          </div>
                        </div>
                      </td>
                      <td className='px-2 py-2'>
                        <Input
                          value={draft.number}
                          disabled={!editable}
                          onChange={(event) =>
                            setDraft(row.id, { number: event.target.value })
                          }
                          className={cn(
                            'h-8 font-mono',
                            !draft.number.trim() &&
                              row.status === 'pending_review' &&
                              'border-rose-400'
                          )}
                          placeholder='A-101'
                        />
                        {row.detected.number &&
                          row.detected.number !== draft.number && (
                            <p className='mt-1 text-[11px] text-muted-foreground'>
                              read: {row.detected.number}
                            </p>
                          )}
                      </td>
                      <td className='px-2 py-2'>
                        <Input
                          value={draft.title}
                          disabled={!editable}
                          onChange={(event) =>
                            setDraft(row.id, { title: event.target.value })
                          }
                          className='h-8'
                          placeholder='Sheet title'
                        />
                      </td>
                      <td className='px-2 py-2'>
                        <Input
                          value={draft.revision}
                          disabled={!editable}
                          onChange={(event) =>
                            setDraft(row.id, { revision: event.target.value })
                          }
                          className='h-8 font-mono'
                          placeholder='0'
                        />
                      </td>
                      <td className='px-2 py-2'>
                        <Input
                          value={draft.discipline}
                          disabled={!editable}
                          onChange={(event) =>
                            setDraft(row.id, { discipline: event.target.value })
                          }
                          className='h-8'
                          placeholder='Architectural'
                        />
                      </td>
                      <td className='px-2 py-2'>
                        <ConfidenceBadge
                          value={row.confidence}
                          textStatus={row.textStatus}
                        />
                      </td>
                      <td className='px-2 py-2'>
                        <div className='space-y-1'>
                          {row.status === 'published' && row.sheetId ? (
                            <button
                              type='button'
                              className='inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300'
                              onClick={() => onOpenSheet(row.sheetId as string)}
                            >
                              <CheckCircle2 className='h-3.5 w-3.5' /> Published
                            </button>
                          ) : (
                            <Badge variant='outline'>
                              {revisionStatusLabel(row.status)}
                            </Badge>
                          )}
                          {editable && (
                            <label className='flex items-center gap-1 text-xs text-muted-foreground'>
                              <input
                                type='checkbox'
                                checked={draft.rejected}
                                onChange={(event) =>
                                  setDraft(row.id, {
                                    rejected: event.target.checked,
                                  })
                                }
                              />
                              Not a sheet
                            </label>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
