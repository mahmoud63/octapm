import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
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

type ImportFormat = 'xer' | 'p6xml' | 'msp'

const FORMAT_CONFIG: Record<
  ImportFormat,
  { label: string; accept: string; endpoint: string }
> = {
  xer: { label: 'P6 XER', accept: '.xer', endpoint: 'xer' },
  p6xml: { label: 'P6 XML', accept: '.xml', endpoint: 'p6xml' },
  msp: { label: 'MSP XML', accept: '.xml', endpoint: 'msp' },
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

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Select a file first')

      const formData = new FormData()
      formData.append('file', file)

      const response = await apiClient.post(
        `/projects/${projectId}/import/${FORMAT_CONFIG[format].endpoint}`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )

      return response.data.data as ImportResult
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
      ])
      toast.success('Schedule import staged for review')
    },
    onError: (error: unknown) => {
      const message =
        (
          error as {
            response?: { data?: { error?: { message?: string } } }
            message?: string
          }
        )?.response?.data?.error?.message ||
        (error as { message?: string })?.message ||
        'Import failed'

      toast.error(message)
    },
  })

  const reset = () => {
    setFile(null)
    setResult(null)
    setFormat('xer')
  }

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
            Import activities, WBS, and relationships from Primavera or MSP.
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
                      onChange={() => setFormat(value)}
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
                disabled={!file || importMutation.isPending}
                onClick={() => importMutation.mutate()}
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
