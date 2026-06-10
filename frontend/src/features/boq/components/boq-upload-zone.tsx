import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, FileSpreadsheet, AlertCircle, Download, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/services/api/client'
import { useBoqUpload, useBoqJobStatus } from '../hooks/use-boq'
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

  const upload = useBoqUpload(projectId)
  const jobQuery = useBoqJobStatus(projectId, jobId)
  const job = jobQuery.data

  const isDone = job?.status === 'done'
  const isError = job?.status === 'error'
  const isPending = upload.isPending || (!!jobId && !isDone && !isError)

  useEffect(() => {
    if (isDone) {
      if (job?.mode === 'comparison_only') {
        toast.success('BOQ revision comparison saved')
      } else {
        toast.success('BOQ processed - activities generated')
      }
      onUploadSuccess()
      setJobId(null)
    }
  }, [isDone, job?.mode, onUploadSuccess])

  useEffect(() => {
    if (isError) {
      setLocalError(job?.error ?? 'AI processing failed. Try uploading again.')
      setJobId(null)
    }
  }, [isError, job?.error])

  const handleFile = useCallback(
    async (file: File) => {
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
      try {
        const result = await upload.mutateAsync({ file, label: revisionLabel })
        setJobId(result.jobId)
      } catch (err: unknown) {
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
      }
    },
    [upload, revisionLabel],
  )

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

  const progress = job?.progress ?? (upload.isPending ? 20 : 0)
  const stepLabel = job?.step ?? (upload.isPending ? 'Uploading and checking file...' : '')
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

      {/* Drop zone */}
      <div
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
              AI is analysing your BOQ and generating activities…
            </p>
          </div>
        ) : localError ? (
          <>
            <AlertCircle className='h-10 w-10 text-destructive' />
            <div>
              <p className='font-semibold text-destructive'>Processing failed</p>
              <p className='mt-1 text-sm text-muted-foreground'>{localError}</p>
              <p className='mt-2 text-xs text-muted-foreground'>
                Click to try again with a new file
              </p>
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
                  : '.xlsx or .xls - AI generates activities automatically'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      {!isPending && (
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
      {!isPending && (
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
