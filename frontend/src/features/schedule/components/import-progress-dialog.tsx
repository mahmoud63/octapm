import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { projectSetupReadinessKey } from '@/features/projects/hooks/use-projects'
import {
  progressImportHeadline,
  progressImportRowFigure,
  progressImportRowLabel,
  progressImportRowSupersededNote,
  progressImportSupersededNote,
  type ProgressImportResult,
  type ProgressImportRowStatus,
} from '../lib/progress-import-outcome'

type ProgressFormat = 'xer' | 'p6xml'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ROW_VARIANT: Record<
  ProgressImportRowStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  submit: 'secondary',
  approve: 'default',
  hold: 'outline',
  refuse: 'destructive',
  submitted: 'secondary',
  draft: 'outline',
  approved: 'default',
  pending: 'outline',
  unchanged: 'outline',
  already_pending: 'outline',
  skipped: 'outline',
  refused: 'destructive',
}

const errorMessage = (error: unknown, fallback: string) =>
  (
    error as {
      response?: { data?: { error?: { message?: string } } }
      message?: string
    }
  )?.response?.data?.error?.message ||
  (error as { message?: string })?.message ||
  fallback

export function ImportProgressDialog({ projectId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [format, setFormat] = useState<ProgressFormat>('xer')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ProgressImportResult | null>(null)
  const [result, setResult] = useState<ProgressImportResult | null>(null)

  const send = async (dryRun: boolean) => {
    if (!file) throw new Error('Select a file first')
    const formData = new FormData()
    formData.append('file', file)
    formData.append('format', format)
    const response = await apiClient.post(
      `/projects/${projectId}/import/progress${dryRun ? '?dryRun=true' : ''}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
    return response.data.data as ProgressImportResult
  }

  const previewMutation = useMutation({
    mutationFn: () => send(true),
    onSuccess: (data) => setPreview(data),
    onError: (error: unknown) =>
      toast.error(errorMessage(error, 'Progress preview failed')),
  })

  const mutation = useMutation({
    mutationFn: () => send(false),
    onSuccess: async (data) => {
      setResult(data)
      // Everything an import can move — the same set the progress tab
      // refreshes after an approval: an approver's import made figures
      // official, so the EV report, the audit history and the readiness
      // headline beside this dialog must not stay stale.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['activities', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['ev-report', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['progress-submissions', projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['daily-reports', projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['audit-events', projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: projectSetupReadinessKey(projectId),
        }),
      ])
      toast.success(progressImportHeadline(data))
    },
    onError: (error: unknown) =>
      toast.error(errorMessage(error, 'Progress import failed')),
  })

  const reset = () => {
    setFormat('xer')
    setFile(null)
    setPreview(null)
    setResult(null)
  }

  const shown = result ?? preview
  // What a reviewer reads: rows a gate or the writer said something about,
  // rows measured another way, rows approved as they already stood in the
  // queue, and rows that left an older pending figure behind. A row that
  // was skipped or is already official carries its reason and is listed
  // too; a plain unchanged 0% row from a full-programme export is not.
  const reportedRows = shown
    ? shown.rows.filter(
        (row) =>
          (row.reason && row.status !== 'unchanged') ||
          row.methodMismatch ||
          row.approvesPending ||
          (row.superseded?.length ?? 0) > 0
      )
    : []
  const supersededNote = shown ? progressImportSupersededNote(shown) : ''

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Import Progress from P6</DialogTitle>
          <DialogDescription>
            Percentages matched by P6 activity id become progress submissions.
            They are official only once approved through the progress approval
            gates — by you, if you hold approval on this project, or by an
            approver later. Activities are not deleted or recreated.
          </DialogDescription>
        </DialogHeader>

        {shown ? (
          <div className='space-y-3' data-testid='progress-import-outcome'>
            <div
              className={
                shown.authority.canApprove && !shown.dryRun
                  ? 'rounded-md border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950'
                  : 'rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950'
              }
            >
              <p className='font-semibold'>
                {shown.dryRun
                  ? 'Preview — nothing written yet'
                  : 'Import complete'}
              </p>
              <p data-testid='progress-import-headline'>
                {progressImportHeadline(shown)}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {shown.message}
              </p>
              {supersededNote && (
                <p
                  className='mt-1 text-xs'
                  data-testid='progress-import-superseded'
                >
                  {supersededNote}
                </p>
              )}
              <dl className='mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs'>
                <dt>Matched</dt>
                <dd>{shown.matched}</dd>
                <dt>Not matched</dt>
                <dd>{shown.notMatched}</dd>
                {shown.dryRun ? (
                  <>
                    {shown.authority.canApprove ? (
                      <>
                        <dt>Will be approved</dt>
                        <dd>{shown.wouldApprove ?? 0}</dd>
                        <dt>Will be left pending (a gate refuses)</dt>
                        <dd>{shown.wouldHold ?? 0}</dd>
                      </>
                    ) : (
                      <>
                        <dt>Will be submitted for approval</dt>
                        <dd>{shown.wouldSubmit ?? 0}</dd>
                        <dt>Will be kept as draft (evidence required)</dt>
                        <dd>{shown.wouldHold ?? 0}</dd>
                      </>
                    )}
                    <dt>Will be refused</dt>
                    <dd>{shown.wouldRefuse ?? 0}</dd>
                  </>
                ) : (
                  <>
                    <dt>Submitted for approval</dt>
                    <dd>{shown.submitted}</dd>
                    <dt>Approved</dt>
                    <dd>{shown.approved}</dd>
                    <dt>Left pending (a gate refused)</dt>
                    <dd>{shown.pending}</dd>
                    <dt>Kept as draft (evidence required)</dt>
                    <dd>{shown.draft}</dd>
                    <dt>Refused</dt>
                    <dd>{shown.refused}</dd>
                  </>
                )}
                <dt>Already official (unchanged)</dt>
                <dd>{shown.unchanged}</dd>
                <dt>Already pending</dt>
                <dd>{shown.alreadyPending}</dd>
                <dt>Skipped (no percentage)</dt>
                <dd>{shown.skipped ?? 0}</dd>
                <dt>Older pending left in the queue</dt>
                <dd>{shown.supersededPending ?? 0}</dd>
              </dl>
            </div>

            {reportedRows.length > 0 && (
              <ul className='max-h-56 space-y-1 overflow-y-auto text-xs'>
                {reportedRows.map((row) => (
                  <li
                    key={row.activityId}
                    className='flex flex-col gap-0.5 rounded border p-2'
                    data-testid='progress-import-row'
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <span className='font-medium'>
                        {row.p6ActivityId} · {row.name} ·{' '}
                        {progressImportRowFigure(row)}
                      </span>
                      <Badge variant={ROW_VARIANT[row.status]}>
                        {progressImportRowLabel(row)}
                      </Badge>
                    </div>
                    {row.reason && (
                      <span className='text-muted-foreground'>
                        {row.reason.message}
                      </span>
                    )}
                    {row.methodMismatch && (
                      <span className='text-muted-foreground'>
                        Measured by {row.activityMethod}; the file gives a
                        percentage, recorded as a percent submission.
                      </span>
                    )}
                    {(row.superseded?.length ?? 0) > 0 && (
                      <span className='text-muted-foreground'>
                        {progressImportRowSupersededNote(row)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {shown.dryRun ? (
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  className='flex-1'
                  onClick={() => setPreview(null)}
                >
                  Back
                </Button>
                <Button
                  className='flex-1'
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate()}
                >
                  {mutation.isPending
                    ? 'Importing...'
                    : shown.authority.canApprove
                      ? 'Import and approve'
                      : 'Submit for approval'}
                </Button>
              </div>
            ) : (
              <Button className='w-full' onClick={() => onOpenChange(false)}>
                Close
              </Button>
            )}
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>Format</Label>
              <div className='flex gap-4 text-sm'>
                <label className='flex items-center gap-2'>
                  <input
                    type='radio'
                    name='progress-format'
                    value='xer'
                    checked={format === 'xer'}
                    onChange={() => setFormat('xer')}
                  />
                  P6 XER
                </label>
                <label className='flex items-center gap-2'>
                  <input
                    type='radio'
                    name='progress-format'
                    value='p6xml'
                    checked={format === 'p6xml'}
                    onChange={() => setFormat('p6xml')}
                  />
                  P6 XML
                </label>
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='progress-file'>File</Label>
              <Input
                id='progress-file'
                type='file'
                accept={format === 'xer' ? '.xer' : '.xml'}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className='flex gap-2'>
              <Button
                variant='outline'
                className='flex-1'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                className='flex-1'
                disabled={!file || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                {previewMutation.isPending ? 'Checking...' : 'Preview'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
