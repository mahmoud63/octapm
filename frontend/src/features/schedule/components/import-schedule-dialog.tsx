import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
import { projectSetupReadinessKey } from '@/features/projects/hooks/use-projects'
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

type ImportFormat = 'xer' | 'p6xml' | 'msp' | 'xlsx'

// `preview` marks the formats whose endpoint takes ?dryRun=true (only the
// workbook import does); the others ignore the flag, so they are never sent
// it — a "preview" that silently imported would be worse than none.
const FORMAT_CONFIG: Record<
  ImportFormat,
  { label: string; accept: string; endpoint: string; preview: boolean }
> = {
  xer: { label: 'P6 XER', accept: '.xer', endpoint: 'xer', preview: false },
  p6xml: { label: 'P6 XML', accept: '.xml', endpoint: 'p6xml', preview: false },
  msp: { label: 'MSP XML', accept: '.xml', endpoint: 'msp', preview: false },
  xlsx: { label: 'Excel (.xlsx)', accept: '.xlsx', endpoint: 'xlsx', preview: true },
}

type ImportResult = {
  staged?: boolean
  revisionId?: string
  imported: number
  wbsNodes?: number
  criticalActivities?: number
  dependencyCount?: number
  message?: string
}

type ImportIssue = {
  row: number | null
  field?: string
  code: string
  message: string
}

/** The workbook import's dry run, as the server reports it. Nothing was stored. */
type ImportPreview = {
  dryRun: true
  source: string
  activityCount: number
  dependencyCount: number
  wbsNodeCount: number
  criticalActivities: number
  issueCount: number
  issues: ImportIssue[]
  activities: Array<{
    draftKey: string
    sourceActivityId: string | null
    name: string
    wbsCode: string | null
    duration: number
    isCritical: boolean
  }>
  rowLimit: number
  message?: string
}

// How many sample activities and issues the preview lists; the counts are
// the server's complete counts.
const PREVIEW_SAMPLE_ROWS = 8

const errorMessage = (error: unknown, fallback: string) =>
  (
    error as {
      response?: { data?: { error?: { message?: string } } }
      message?: string
    }
  )?.response?.data?.error?.message ||
  (error as { message?: string })?.message ||
  fallback

const uploadFile = async (
  projectId: string,
  format: ImportFormat,
  file: File,
  dryRun: boolean
) => {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiClient.post(
    `/projects/${projectId}/import/${FORMAT_CONFIG[format].endpoint}`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      ...(dryRun ? { params: { dryRun: true } } : {}),
    }
  )
  return response.data.data
}

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportScheduleDialog({ projectId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [format, setFormat] = useState<ImportFormat>('xer')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  // A dry-run report with the file and format it was made for. Choosing
  // another file or format clears it; and since the file input stays open
  // while a preview is in flight, an answer for a file since replaced may
  // still land here — so it is shown, and Import waits on it, only while
  // its file is the one now selected (below).
  const [previewed, setPreviewed] = useState<{
    file: File
    format: ImportFormat
    report: ImportPreview
  } | null>(null)
  // The file now selected, for the callbacks (which outlive their render).
  const selectedFile = useRef<File | null>(null)

  const previewable = FORMAT_CONFIG[format].preview

  const previewMutation = useMutation({
    mutationFn: async (target: { file: File; format: ImportFormat }) => ({
      ...target,
      report: (await uploadFile(projectId, target.format, target.file, true)) as ImportPreview,
    }),
    // A dry run writes nothing, so it invalidates nothing.
    onSuccess: (data) => setPreviewed(data),
    // A failure for a file since replaced is not the selected file's.
    onError: (error: unknown, target) => {
      if (target.file !== selectedFile.current) return
      toast.error(errorMessage(error, 'Preview failed'))
    },
  })

  // The preview of exactly the file (and format) now selected, or none.
  const preview =
    previewed && previewed.file === file && previewed.format === format
      ? previewed.report
      : null

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Select a file first')
      return (await uploadFile(projectId, format, file, false)) as ImportResult
    },
    onSuccess: async (data) => {
      setResult(data)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['activities', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['cost-summary', projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ['long-lead', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['schedule-revisions', projectId],
        }),
        // A staged revision moves the setup readiness (the guide's one query).
        queryClient.invalidateQueries({
          queryKey: projectSetupReadinessKey(projectId),
        }),
      ])
      toast.success('Schedule import staged for review')
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Import failed')),
  })

  const reset = () => {
    selectedFile.current = null
    setFile(null)
    setResult(null)
    setPreviewed(null)
    setFormat('xer')
  }

  const busy = importMutation.isPending || previewMutation.isPending
  // A workbook is previewed before it is imported: Import waits for the
  // preview of the file now selected.
  const importBlocked = !file || busy || (previewable && !preview)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Import Schedule</DialogTitle>
          <DialogDescription>
            Import activities, WBS, and relationships from Primavera, MSP or an
            Excel workbook. The import is staged as a draft revision for review.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className='space-y-3'>
            <div className='rounded-md border border-green-200 bg-green-50 p-3 text-sm'>
              <p className='font-semibold text-green-700'>Import Complete</p>
              <p>Activities imported: {result.imported}</p>
              <p>WBS nodes: {result.wbsNodes ?? 0}</p>
              <p>Critical activities: {result.criticalActivities ?? 0}</p>
              <p>Relationships staged: {result.dependencyCount ?? 0}</p>
              {result.revisionId && <p>Revision: {result.revisionId}</p>}
            </div>
            <Button className='w-full' onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>Format</Label>
              <div className='flex flex-wrap gap-4 text-sm'>
                {(Object.keys(FORMAT_CONFIG) as ImportFormat[]).map((value) => (
                  <label key={value} className='flex items-center gap-2'>
                    <input
                      type='radio'
                      name='import-format'
                      value={value}
                      checked={format === value}
                      onChange={() => {
                        setFormat(value)
                        setPreviewed(null)
                      }}
                    />
                    {FORMAT_CONFIG[value].label}
                  </label>
                ))}
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='import-schedule-file'>File</Label>
              <Input
                id='import-schedule-file'
                type='file'
                accept={FORMAT_CONFIG[format].accept}
                onChange={(e) => {
                  selectedFile.current = e.target.files?.[0] ?? null
                  setFile(selectedFile.current)
                  setPreviewed(null)
                }}
              />
              {!previewable && (
                <p className='text-xs text-muted-foreground'>
                  Preview is available for Excel workbooks. P6 and MSP files
                  are staged as a draft revision you review before it is
                  activated.
                </p>
              )}
            </div>

            {preview && (
              <div
                className='space-y-2 rounded-md border p-3 text-sm'
                data-testid='schedule-import-preview'
              >
                <p className='font-semibold'>
                  Preview — nothing has been saved yet
                </p>
                <ul className='grid grid-cols-2 gap-1 text-xs'>
                  {(
                    [
                      ['activities', 'Activities', preview.activityCount],
                      ['dependencies', 'Relationships', preview.dependencyCount],
                      ['wbs', 'WBS nodes', preview.wbsNodeCount],
                      ['critical', 'Critical activities', preview.criticalActivities],
                      ['issues', 'Issues', preview.issueCount],
                    ] as const
                  ).map(([key, label, value]) => (
                    <li
                      key={key}
                      data-testid={`schedule-import-preview-${key}`}
                      data-value={value}
                    >
                      {label}: <span className='font-semibold'>{value}</span>
                    </li>
                  ))}
                </ul>
                {preview.issues.length > 0 && (
                  <ul className='list-disc space-y-0.5 ps-5 text-xs text-amber-700 dark:text-amber-300'>
                    {preview.issues.slice(0, PREVIEW_SAMPLE_ROWS).map((issue, index) => (
                      <li key={`${issue.code}-${issue.row ?? 'file'}-${index}`}>
                        {issue.row != null ? `Row ${issue.row}: ` : ''}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                {preview.activities.length > 0 && (
                  <ul className='space-y-0.5 text-xs text-muted-foreground'>
                    {preview.activities.slice(0, PREVIEW_SAMPLE_ROWS).map((activity) => (
                      <li key={activity.draftKey}>
                        <span className='font-mono'>
                          {activity.sourceActivityId ?? activity.draftKey}
                        </span>{' '}
                        {activity.name} — {activity.duration}d
                        {activity.isCritical ? ' · critical' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className='flex gap-2'>
              <Button
                variant='outline'
                className='flex-1'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              {previewable && (
                <Button
                  variant='outline'
                  className='flex-1'
                  disabled={!file || busy}
                  onClick={() => file && previewMutation.mutate({ file, format })}
                  data-testid='schedule-import-preview-run'
                >
                  {previewMutation.isPending ? 'Reading...' : 'Preview'}
                </Button>
              )}
              <Button
                className='flex-1'
                disabled={importBlocked}
                onClick={() => importMutation.mutate()}
                data-testid='schedule-import-confirm'
              >
                {importMutation.isPending ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
