import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, FileSpreadsheet, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGenerateSchedule } from '../hooks/use-schedule'
import { GenerationProgress } from './generation-progress'
import { ImportScheduleDialog } from './import-schedule-dialog'

interface Props {
  projectId: string
  project: {
    name?: string
    startDate?: string | null
    duration?: number | null
  }
}

export function ScheduleUploadZone({ projectId, project }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [revisionLabel, setRevisionLabel] = useState('')
  const [isImportScheduleOpen, setImportScheduleOpen] = useState(false)
  const { trigger, isPending, currentStep, error } =
    useGenerateSchedule(projectId)
  const stepText = currentStep.toLowerCase()
  const isRateLimited =
    stepText.includes('rate limit') ||
    stepText.includes('rate limited') ||
    stepText.includes('overloaded')

  const readinessIssues: string[] = []
  if (!project.name?.trim()) readinessIssues.push('Project name missing')
  if (!project.startDate) {
    readinessIssues.push('Project start date missing — edit project to set it')
  }
  if (!project.duration || project.duration <= 0) {
    readinessIssues.push('Project duration missing — edit project to set it')
  }

  // Show toast when error arrives from poller
  useEffect(() => {
    if (error) toast.error(error)
  }, [error])

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
        toast.error('Supported formats: .xlsx, .xls, .csv')
        return
      }
      try {
        await trigger({ file, label: revisionLabel })
        // success toast comes when polling detects 'done' and schedule reloads
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? 'Failed to start generation'
        toast.error(msg)
      }
    },
    [trigger, revisionLabel]
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

  return (
    <div className='flex flex-col items-center justify-center py-16'>
      <div className='mb-4 w-full max-w-lg'>
        <label className='mb-1 block text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
          Revision Label (optional)
        </label>
        <Input
          value={revisionLabel}
          onChange={(e) => setRevisionLabel(e.target.value)}
          placeholder='Rev 2 - Updated Electrical'
          disabled={isPending}
        />
      </div>

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
          accept='.xlsx,.xls,.csv'
          className='hidden'
          onChange={onInputChange}
        />

        {isPending ? (
          <div className='w-full max-w-xl'>
            <GenerationProgress
              currentStep={
                (stepText.includes('pass 3') && 2) ||
                (stepText.includes('pass 2') && 1) ||
                0
              }
              totalSteps={3}
              steps={[
                {
                  label: 'Pass 1: Structuring BOQ',
                  description: 'Parsing BOQ and cleaning rows',
                },
                {
                  label: 'Pass 2: Generating CPM Schedule',
                  description: 'Building activities and dependencies',
                },
                {
                  label: 'Pass 3: Allocating Resources',
                  description: 'Assigning labor, equipment, and materials',
                },
              ]}
              progress={
                (stepText.includes('pass 3') && 88) ||
                (stepText.includes('pass 2') && 55) ||
                20
              }
              step={currentStep}
            />
            {isRateLimited && (
              <p className='mt-2 text-xs text-amber-600 dark:text-amber-400'>
                Anthropic API is busy. Retrying automatically...
              </p>
            )}
          </div>
        ) : error ? (
          <>
            <AlertCircle className='h-10 w-10 text-destructive' />
            <div>
              <p className='font-semibold text-destructive'>
                Generation failed
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>{error}</p>
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
              <p className='font-semibold'>
                Upload BOQ or Activity Spreadsheet
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                Drag & drop or click to browse
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                .xlsx &nbsp;·&nbsp; .xls &nbsp;·&nbsp; .csv (AI generation)
              </p>
            </div>
          </>
        )}
      </div>

      {!isPending && (
        <div className='mt-6 grid grid-cols-3 gap-3 text-center text-xs text-muted-foreground'>
          {[
            ['📋', 'BOQ Spreadsheet', 'Bill of Quantities in Excel'],
            ['🗂', 'P6 Export', 'Exported activity list as CSV/Excel'],
            ['📊', 'Activity Schedule', 'Any structured activity list'],
          ].map(([icon, title, desc]) => (
            <div key={title} className='rounded-lg border p-3'>
              <div className='mb-1 text-lg'>{icon}</div>
              <div className='font-medium text-foreground'>{title}</div>
              <div>{desc}</div>
            </div>
          ))}
        </div>
      )}

      {!isPending && (
        <Button
          variant='outline'
          size='sm'
          className='mt-6'
          onClick={() => fileRef.current?.click()}
        >
          <FileSpreadsheet className='mr-2 h-4 w-4' />
          Choose File
        </Button>
      )}

      {!isPending && (
        <Button
          variant='outline'
          size='sm'
          className='mt-2'
          onClick={() => setImportScheduleOpen(true)}
        >
          Import Schedule (P6/MSP)
        </Button>
      )}

      <ImportScheduleDialog
        projectId={projectId}
        open={isImportScheduleOpen}
        onOpenChange={setImportScheduleOpen}
      />
    </div>
  )
}
