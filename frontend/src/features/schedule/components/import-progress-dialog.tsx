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

type ProgressFormat = 'xer' | 'p6xml'

type ProgressResult = {
  updated: number
  notMatched: number
  message: string
}

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportProgressDialog({ projectId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [format, setFormat] = useState<ProgressFormat>('xer')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ProgressResult | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Select a file first')

      const formData = new FormData()
      formData.append('file', file)
      formData.append('format', format)

      const response = await apiClient.post(
        `/projects/${projectId}/import/progress`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )

      return response.data.data as ProgressResult
    },
    onSuccess: async (data) => {
      setResult(data)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['activities', projectId] }),
      ])
      toast.success('Progress import completed')
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
        'Progress import failed'

      toast.error(message)
    },
  })

  const reset = () => {
    setFormat('xer')
    setFile(null)
    setResult(null)
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
          <DialogTitle>Import Progress from P6</DialogTitle>
          <DialogDescription>
            Updates progress only, matched by p6ActivityId. Activities are not
            deleted or recreated.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className='space-y-3'>
            <div className='rounded-md border border-green-200 bg-green-50 p-3 text-sm'>
              <p className='font-semibold text-green-700'>Progress Updated</p>
              <p>Updated activities: {result.updated}</p>
              <p>Not matched: {result.notMatched}</p>
            </div>
            <Button className='w-full' onClick={() => onOpenChange(false)}>
              Close
            </Button>
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
                disabled={!file || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? 'Importing...' : 'Update Progress'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
