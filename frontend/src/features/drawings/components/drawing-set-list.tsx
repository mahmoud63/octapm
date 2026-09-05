import { useState } from 'react'
import { Layers, Loader2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
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
import {
  SET_PURPOSES,
  formatBytes,
  useDrawingSets,
  useUploadDrawingSet,
  type DrawingSet,
} from '../hooks/use-drawings'

const STATUS_LABEL: Record<DrawingSet['status'], string> = {
  draft: 'Draft',
  processing: 'Processing',
  review: 'Ready for review',
  published: 'Published',
  archived: 'Archived',
  failed: 'Failed',
}

const PURPOSE_LABEL: Record<string, string> = {
  IFC: 'Issued for construction',
  IFT: 'Issued for tender',
  IFA: 'Issued for approval',
  AS_BUILT: 'As built',
  TENDER: 'Tender',
  SHOP: 'Shop drawings',
  RECORD: 'Record',
  OTHER: 'Other',
}

const NO_PURPOSE = '__none'

function UploadSetDialog({
  projectId,
  open,
  onOpenChange,
  onUploaded,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: (set: DrawingSet) => void
}) {
  const upload = useUploadDrawingSet(projectId)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [purpose, setPurpose] = useState<string>('IFC')
  const [receivedAt, setReceivedAt] = useState('')
  const [progress, setProgress] = useState(0)

  const reset = () => {
    setFile(null)
    setName('')
    setDiscipline('')
    setPurpose('IFC')
    setReceivedAt('')
    setProgress(0)
  }

  const submit = async () => {
    if (!file) return
    try {
      const set = await upload.mutateAsync({
        file,
        name: name.trim() || undefined,
        discipline: discipline.trim() || undefined,
        purpose: purpose === NO_PURPOSE ? undefined : purpose,
        receivedAt: receivedAt || undefined,
        onProgress: setProgress,
      })
      toast.success(`${set.setNumber} uploaded — reading title blocks`)
      onOpenChange(false)
      reset()
      onUploaded(set)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a drawing set</DialogTitle>
          <DialogDescription>
            One PDF with every sheet. Sheet numbers, titles and revisions are
            read from each page's title block for you to check before
            publishing.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='drawing-set-file'>Set PDF</Label>
            <Input
              id='drawing-set-file'
              type='file'
              accept='application/pdf,.pdf'
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null
                setFile(picked)
                if (picked && !name) setName(picked.name.replace(/\.pdf$/i, ''))
              }}
              data-testid='uat-drawing-set-file'
            />
            {file && (
              <p className='text-xs text-muted-foreground'>
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </div>
          <div className='space-y-1'>
            <Label htmlFor='drawing-set-name'>Name</Label>
            <Input
              id='drawing-set-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='e.g. Architectural IFC set'
              maxLength={160}
            />
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='drawing-set-purpose'>Issued for</Label>
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger id='drawing-set-purpose'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SET_PURPOSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PURPOSE_LABEL[value]}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_PURPOSE}>Not specified</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label htmlFor='drawing-set-discipline'>Default discipline</Label>
              <Input
                id='drawing-set-discipline'
                value={discipline}
                onChange={(event) => setDiscipline(event.target.value)}
                placeholder='Used when a number has no prefix'
                maxLength={80}
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='drawing-set-received'>Received on</Label>
            <Input
              id='drawing-set-received'
              type='date'
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </div>
          {upload.isPending && (
            <div className='space-y-1'>
              <div className='h-1.5 overflow-hidden rounded bg-muted'>
                <div
                  className='h-full bg-primary transition-all'
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className='text-xs text-muted-foreground'>
                Uploading {progress}%
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!file || upload.isPending}
            data-testid='uat-drawing-set-upload'
          >
            <UploadCloud className='mr-2 h-4 w-4' />
            {upload.isPending ? 'Uploading…' : 'Upload set'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DrawingSetList({
  projectId,
  onOpenSet,
}: {
  projectId: string
  onOpenSet: (setId: string) => void
}) {
  const canUpload = useCanPerform(
    'document_control',
    'submit',
    'document.revision.upload'
  )
  const [showArchived, setShowArchived] = useState(false)
  const { data, isLoading } = useDrawingSets(projectId, {
    status: showArchived ? 'all' : undefined,
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const sets = data?.items ?? []

  return (
    <div className='space-y-3' data-testid='uat-drawing-sets'>
      <div className='flex flex-wrap items-center gap-2'>
        <p className='text-sm text-muted-foreground'>
          A set is one PDF issued by a designer. Publish it to update the sheets
          the site works from.
        </p>
        <div className='ml-auto flex items-center gap-2'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setShowArchived((value) => !value)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
          {canUpload && (
            <Button
              size='sm'
              onClick={() => setUploadOpen(true)}
              data-testid='uat-drawing-set-new'
            >
              <UploadCloud className='mr-2 h-4 w-4' /> Upload set
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading sets…
        </div>
      ) : sets.length === 0 ? (
        <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          <Layers className='mx-auto mb-2 h-6 w-6' />
          No drawing sets yet. Upload the first set to build the sheet register.
        </div>
      ) : (
        <ul className='divide-y rounded-md border'>
          {sets.map((set) => (
            <li key={set.id}>
              <button
                type='button'
                className='flex w-full flex-wrap items-center gap-3 px-3 py-3 text-left hover:bg-accent/50'
                onClick={() => onOpenSet(set.id)}
                data-testid='uat-drawing-set-item'
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-mono text-sm font-semibold'>
                      {set.setNumber}
                    </span>
                    <span className='truncate font-medium'>{set.name}</span>
                    <Badge
                      variant={
                        set.status === 'failed'
                          ? 'destructive'
                          : set.status === 'review'
                            ? 'default'
                            : 'outline'
                      }
                    >
                      {STATUS_LABEL[set.status]}
                    </Badge>
                    {set.purpose && (
                      <Badge variant='secondary'>
                        {PURPOSE_LABEL[set.purpose] ?? set.purpose}
                      </Badge>
                    )}
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {[
                      set.pageCount ? `${set.pageCount} pages` : null,
                      set.sizeBytes ? formatBytes(set.sizeBytes) : null,
                      set.counts
                        ? `${set.counts.published} published · ${set.counts.pending} pending`
                        : null,
                      set.receivedAt
                        ? `received ${new Date(set.receivedAt).toLocaleDateString()}`
                        : null,
                      `uploaded ${new Date(set.createdAt).toLocaleDateString()}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {set.status === 'processing' && (
                    <div className='mt-1 h-1 w-48 overflow-hidden rounded bg-muted'>
                      <div
                        className='h-full bg-primary transition-all'
                        style={{ width: `${set.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <UploadSetDialog
          projectId={projectId}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUploaded={(set) => onOpenSet(set.id)}
        />
      )}
    </div>
  )
}
