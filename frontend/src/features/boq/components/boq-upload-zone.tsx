import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Download,
  Lock,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/services/api/client'
import {
  useBoqUpload,
  useBoqUploadPreview,
  useBoqJobStatus,
  useRetryBoqJob,
  type BoqPreviewRow,
  type BoqUploadPreview,
} from '../hooks/use-boq'
import { BoqValidationDialog } from './boq-validation-dialog'

interface Props {
  projectId: string
  project: {
    name?: string
    startDate?: string | null
    duration?: number | null
  }
  hasExistingBoq?: boolean
  baseline?: {
    locked: boolean
    source: 'schedule_baseline' | 'boq_revision' | null
    lockedAt: string | null
  }
  onUploadSuccess: () => void
}

interface ValidationError {
  row?: number
  field?: string
  message: string
}

const MAX_BOQ_UPLOAD_BYTES = 50 * 1024 * 1024

// How many sample rows of each kind the preview lists; the counts above them
// are the server's complete counts.
const PREVIEW_SAMPLE_ROWS = 8

const formatFigure = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })

const describeRow = (row: BoqPreviewRow) =>
  `${formatFigure(row.quantity, 3)} ${row.unit ?? ''} × ${formatFigure(row.rate)} = ${formatFigure(row.amount)}`.trim()

/**
 * The dry run's report, shown before anything is written: what the file
 * holds, how it compares with the current bill, the rows the upload would
 * refuse, and the units and mapping rules it carries. Every figure is the
 * server's; this panel only lays them out.
 */
function BoqUploadPreviewPanel({
  fileName,
  report,
  importing,
  onConfirm,
  onCancel,
}: {
  fileName: string
  report: BoqUploadPreview
  importing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { summary } = report.comparison
  const counts: Array<[keyof typeof summary, string]> = [
    ['added', 'New rows'],
    ['updated', 'Changed rows'],
    ['unchanged', 'Unchanged rows'],
    ['removed', 'Rows not in the file'],
    ['blocked', 'Rows the upload would refuse'],
  ]
  const comparisonOnly = report.mode === 'comparison_only'
  const refused = summary.blocked > 0

  return (
    <div
      className='w-full max-w-lg space-y-4 rounded-xl border p-4 text-sm'
      data-testid='boq-upload-preview'
      data-mode={report.mode}
    >
      <div>
        <p className='font-semibold'>Preview — nothing has been saved yet</p>
        <p className='mt-1 text-xs text-muted-foreground'>
          {fileName}: {formatFigure(report.rowCount, 0)} rows, total{' '}
          <span data-testid='boq-upload-preview-total'>{formatFigure(report.totalAmount)}</span>
          {' '}(from the file).
        </p>
        <p className='mt-1 text-xs text-muted-foreground' data-testid='boq-upload-preview-mode'>
          {comparisonOnly
            ? 'The baseline is locked: importing saves this file as a revision comparison. Current rows, allocations, progress and IPC stay unchanged.'
            : 'Importing stores this file as a new BOQ revision for review and generates draft allocation links.'}
        </p>
      </div>

      <ul className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
        {counts.map(([key, label]) => (
          <li
            key={key}
            className='rounded-md border p-2'
            data-testid={`boq-upload-preview-${key}`}
            data-value={summary[key]}
          >
            <div className='text-lg font-semibold'>{formatFigure(summary[key], 0)}</div>
            <div className='text-xs text-muted-foreground'>{label}</div>
          </li>
        ))}
      </ul>

      {report.comparison.blocked.length > 0 && (
        <div className='rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive'>
          <p className='font-semibold'>The upload would be refused:</p>
          <ul className='mt-1 list-disc space-y-0.5 ps-5'>
            {report.comparison.blocked.slice(0, PREVIEW_SAMPLE_ROWS).map((row) => (
              <li key={`${row.code}-${row.existingId}`}>{row.message}</li>
            ))}
          </ul>
        </div>
      )}

      {(report.comparison.added.length > 0 ||
        report.comparison.updated.length > 0 ||
        report.comparison.removed.length > 0) && (
        <div className='space-y-1 text-xs'>
          <p className='font-semibold text-muted-foreground uppercase'>Sample of the changes</p>
          <ul className='space-y-0.5'>
            {report.comparison.added.slice(0, PREVIEW_SAMPLE_ROWS).map((row) => (
              <li key={`a-${row.code}`}>
                <span className='font-mono'>+ {row.code}</span> {row.description} — {describeRow(row)}
              </li>
            ))}
            {report.comparison.updated.slice(0, PREVIEW_SAMPLE_ROWS).map((row) => (
              <li key={`u-${row.code}`}>
                <span className='font-mono'>~ {row.code}</span> {describeRow(row.before)} → {describeRow(row.after)}
              </li>
            ))}
            {report.comparison.removed.slice(0, PREVIEW_SAMPLE_ROWS).map((row) => (
              <li key={`r-${row.code}`}>
                <span className='font-mono'>− {row.code}</span> {row.description} (not in the file)
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.unitWarnings && report.unitWarnings.length > 0 && (
        <div className='text-xs text-amber-700 dark:text-amber-300' data-testid='boq-upload-preview-units'>
          {report.unitWarnings.slice(0, PREVIEW_SAMPLE_ROWS).map((warning) => (
            <p key={warning.message}>{warning.message}</p>
          ))}
        </div>
      )}

      {report.mappingRules && (
        <p className='text-xs text-muted-foreground'>
          Mapping rule column: {report.mappingRules.required} required · {report.mappingRules.optional} optional ·{' '}
          {report.mappingRules.notApplicable} not applicable · {report.mappingRules.unspecified} unspecified
        </p>
      )}

      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          className='flex-1'
          onClick={onCancel}
          disabled={importing}
          data-testid='boq-upload-preview-cancel'
        >
          Cancel
        </Button>
        <Button
          type='button'
          className='flex-1'
          onClick={onConfirm}
          disabled={importing || refused}
          data-testid='boq-upload-preview-confirm'
        >
          {importing ? 'Importing…' : comparisonOnly ? 'Save comparison' : 'Import this file'}
        </Button>
      </div>
    </div>
  )
}

export function BoqUploadZone({
  projectId,
  project,
  hasExistingBoq = false,
  baseline,
  onUploadSuccess,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [revisionLabel, setRevisionLabel] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [showValidation, setShowValidation] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [failedJob, setFailedJob] = useState<{
    id: string
    errorCode: string | null
    attempts: number
    canRetry: boolean
  } | null>(null)

  // The file chosen and the server's dry-run report on it: nothing is stored
  // until the person confirms this preview.
  const [previewed, setPreviewed] = useState<{
    file: File
    report: BoqUploadPreview
  } | null>(null)
  // The file chosen last. While a preview is in flight the zone takes no
  // click or drop, but the input itself stays enabled, so an earlier file's
  // answer can still arrive after a later choice: only the answer for the
  // file chosen last is taken.
  const chosenFile = useRef<File | null>(null)

  const upload = useBoqUpload(projectId)
  const preview = useBoqUploadPreview(projectId)
  const retryJob = useRetryBoqJob(projectId)
  const jobQuery = useBoqJobStatus(projectId, jobId)
  const job = jobQuery.data

  const isDone = job?.status === 'done'
  const isError = job?.status === 'error'
  const isPending =
    preview.isPending ||
    upload.isPending ||
    retryJob.isPending ||
    (!!jobId && !isDone && !isError)

  useEffect(() => {
    if (isDone) {
      if (job?.mode === 'comparison_only') {
        toast.success('BOQ revision comparison saved')
      } else {
        toast.success('BOQ processed - draft allocation links generated')
      }
      onUploadSuccess()
      setJobId(null)
      setFailedJob(null)
    }
  }, [isDone, job?.mode, onUploadSuccess])

  useEffect(() => {
    if (isError && job) {
      setLocalError(job.error ?? 'AI processing failed. Try uploading again.')
      // Keep the durable job id so the user can re-queue it without re-uploading.
      setFailedJob({
        id: job.jobId ?? job.id,
        errorCode: job.errorCode ?? null,
        attempts: job.attempts ?? 0,
        canRetry: Boolean(job.canRetry),
      })
      setJobId(null)
    }
  }, [isError, job])

  const handleRetry = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation()
      if (!failedJob) return
      try {
        const requeued = await retryJob.mutateAsync(failedJob.id)
        setLocalError(null)
        setFailedJob(null)
        setJobId(requeued.jobId ?? failedJob.id)
        toast.info('BOQ processing re-queued')
      } catch (err: unknown) {
        const message =
          (err as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? 'Unable to retry the job'
        toast.error(message)
      }
    },
    [failedJob, retryJob]
  )

  // The dry run and the upload fail the same ways (the same parser and
  // validation), so one reader turns either refusal into what the zone shows.
  const showUploadError = useCallback((err: unknown) => {
    const axiosErr = err as {
      response?: {
        data?: {
          error?: {
            code?: string
            message?: string
            errors?: ValidationError[]
          }
        }
      }
    }
    const errData = axiosErr?.response?.data?.error
    if (errData?.errors?.length) {
      setValidationErrors(errData.errors)
      setShowValidation(true)
    } else if (
      errData?.code === 'FILE_VIRUS_DETECTED' ||
      errData?.code === 'FILE_TYPE_MISMATCH'
    ) {
      setLocalError(errData.message ?? 'File security check failed')
    } else {
      setLocalError(errData?.message ?? 'Upload failed')
    }
  }, [])

  // Choosing a file previews it: the server's dry run parses and compares it
  // with the current bill and writes nothing. The upload happens only when
  // the person confirms that preview.
  const handleFile = useCallback(
    async (file: File) => {
      chosenFile.current = file
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['xlsx', 'xls'].includes(ext || '')) {
        toast.error('Supported formats: .xlsx, .xls')
        return
      }
      if (file.size > MAX_BOQ_UPLOAD_BYTES) {
        setLocalError('The selected workbook is larger than the 50 MB upload limit.')
        return
      }
      setLocalError(null)
      setFailedJob(null)
      setPreviewed(null)
      try {
        const report = await preview.mutateAsync({ file, label: revisionLabel })
        if (chosenFile.current !== file) return
        setPreviewed({ file, report })
      } catch (err: unknown) {
        if (chosenFile.current !== file) return
        showUploadError(err)
      }
    },
    [preview, revisionLabel, showUploadError],
  )

  const confirmPreviewedUpload = useCallback(async () => {
    if (!previewed) return
    try {
      const result = await upload.mutateAsync({
        file: previewed.file,
        label: revisionLabel,
      })
      setPreviewed(null)
      setJobId(result.jobId)
    } catch (err: unknown) {
      setPreviewed(null)
      showUploadError(err)
    }
  }, [previewed, upload, revisionLabel, showUploadError])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const downloadTemplate = () => {
    window.open(
      `${apiClient.defaults.baseURL}/projects/${projectId}/boq/template`,
      '_blank',
    )
  }

  const readinessIssues: string[] = []
  if (!project.name?.trim()) readinessIssues.push('Project name missing')
  if (!project.startDate) readinessIssues.push('Project start date missing — edit project to set it')
  if (!project.duration || project.duration <= 0) readinessIssues.push('Project duration missing — edit project to set it')

  const progress = job?.progress ?? (upload.isPending ? 20 : preview.isPending ? 10 : 0)
  const stepLabel =
    job?.step ??
    (upload.isPending
      ? 'Uploading and checking file...'
      : preview.isPending
        ? 'Reading the workbook and comparing it with the current bill...'
        : '')
  const baselineLocked = Boolean(baseline?.locked)

  return (
    <div className='flex flex-col items-center justify-center py-6'>
      {/* Label input */}
      <div className='mb-4 w-full max-w-lg'>
        <label className='mb-1 block text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
          Revision Label (optional)
        </label>
        <Input
          value={revisionLabel}
          onChange={(e) => setRevisionLabel(e.target.value)}
          placeholder='Rev 1 - Initial BOQ'
          disabled={isPending}
        />
      </div>

      {baselineLocked && (
        <div className='mb-4 flex w-full max-w-lg items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200'>
          <Lock className='mt-0.5 h-4 w-4 flex-shrink-0' />
          <div>
            <p className='font-semibold'>Baseline locked</p>
            <p className='mt-1 text-xs leading-5'>
              Uploads are saved as revision comparisons. Current BOQ rows,
              allocations, progress, IPC, and reports stay unchanged.
            </p>
          </div>
        </div>
      )}

      {/* Readiness warnings */}
      {readinessIssues.length > 0 && (
        <div className='mb-4 w-full max-w-lg rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300'>
          <p className='mb-1 font-semibold'>Before uploading, fix these:</p>
          <ul className='list-disc space-y-0.5 ps-5'>
            {readinessIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {previewed && !isPending && (
        <BoqUploadPreviewPanel
          fileName={previewed.file.name}
          report={previewed.report}
          importing={upload.isPending}
          onConfirm={confirmPreviewedUpload}
          onCancel={() => setPreviewed(null)}
        />
      )}

      {/* Drop zone */}
      <div
        // Kept mounted while a preview is open (it holds the file input),
        // only out of sight.
        style={previewed && !isPending ? { display: 'none' } : undefined}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => !isPending && fileRef.current?.click()}
        className={[
          'flex w-full max-w-lg cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed p-10 text-center transition-colors',
          isPending
            ? 'pointer-events-none border-primary/40 bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
        ].join(' ')}
      >
        <input
          ref={fileRef}
          type='file'
          accept='.xlsx,.xls'
          className='hidden'
          onChange={onInputChange}
        />

        {isPending ? (
          <div className='w-full space-y-3'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              <div className='h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent' />
              {stepLabel}
            </div>
            <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
              <div
                className='h-full rounded-full bg-primary transition-all duration-500'
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className='text-xs text-muted-foreground'>
              {preview.isPending
                ? 'Preview only — nothing is saved until you confirm.'
                : 'AI is analysing your BOQ and generating draft allocation links...'}
            </p>
          </div>
        ) : localError ? (
          <>
            <AlertCircle className='h-10 w-10 text-destructive' />
            <div>
              <p className='font-semibold text-destructive'>Processing failed</p>
              <p className='mt-1 text-sm text-muted-foreground'>{localError}</p>
              {failedJob && (failedJob.errorCode || failedJob.attempts > 0) && (
                <p className='mt-1 font-mono text-[11px] text-muted-foreground'>
                  {failedJob.errorCode ?? 'JOB_FAILED'}
                  {failedJob.attempts > 0 ? ` · attempt ${failedJob.attempts}` : ''}
                </p>
              )}
              {failedJob?.canRetry ? (
                <div className='mt-3 flex flex-wrap justify-center gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    onClick={handleRetry}
                    disabled={retryJob.isPending}
                    data-testid='uat-boq-job-retry'
                  >
                    <RotateCcw className='mr-2 h-4 w-4' />
                    {retryJob.isPending ? 'Re-queuing…' : 'Retry AI processing'}
                  </Button>
                  <span className='self-center text-xs text-muted-foreground'>
                    or click to upload a new file
                  </span>
                </div>
              ) : (
                <p className='mt-2 text-xs text-muted-foreground'>
                  Click to try again with a new file
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className='flex h-14 w-14 items-center justify-center rounded-full bg-muted'>
              <Upload className='h-6 w-6 text-muted-foreground' />
            </div>
            <div>
              <p className='font-semibold'>Upload your BOQ spreadsheet</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                Drag & drop or click to browse
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {hasExistingBoq
                  ? '.xlsx or .xls - compared against the current BOQ'
                  : '.xlsx or .xls - AI generates draft allocation links'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      {!isPending && !previewed && (
        <div className='mt-6 flex gap-3'>
          <Button variant='outline' size='sm' onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet className='mr-2 h-4 w-4' />
            Choose File
          </Button>
          <Button variant='ghost' size='sm' onClick={downloadTemplate}>
            <Download className='mr-2 h-4 w-4' />
            Download Template
          </Button>
        </div>
      )}

      {/* Format guide */}
      {!isPending && !previewed && (
        <div className='mt-6 grid grid-cols-3 gap-3 text-center text-xs text-muted-foreground'>
          {(
            [
              ['Code', 'Item number like "1.1", "2.3"'],
              ['Description', 'Work description (max 500 chars)'],
              ['Qty / Unit / Rate', 'Numeric — Amount auto-calculated'],
            ] as [string, string][]
          ).map(([title, desc]) => (
            <div key={title} className='rounded-lg border p-3'>
              <div className='mb-1 font-medium text-foreground'>{title}</div>
              <div>{desc}</div>
            </div>
          ))}
        </div>
      )}

      <BoqValidationDialog
        open={showValidation}
        onOpenChange={setShowValidation}
        errors={validationErrors}
      />
    </div>
  )
}
