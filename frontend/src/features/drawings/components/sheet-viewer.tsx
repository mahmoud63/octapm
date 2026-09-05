import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  History,
  Loader2,
  Maximize2,
  RotateCw,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
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
import { Switch } from '@/components/ui/switch'
import { CommentThread } from '@/features/comments/components/comment-thread'
import {
  formatBytes,
  usePublishSheetRevision,
  useSheet,
  useUpdateSheet,
  useUploadSheetRevision,
  type SheetRevision,
} from '../hooks/use-drawings'
import { renderSheetPage } from '../lib/pdf'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

const statusLabel = (status: SheetRevision['status']) =>
  ({
    pending_review: 'Pending review',
    published: 'Current',
    superseded: 'Superseded',
    rejected: 'Rejected',
  })[status] ?? status

function RevisionUploadDialog({
  projectId,
  sheetId,
  sheetNumber,
  open,
  onOpenChange,
}: {
  projectId: string
  sheetId: string
  sheetNumber: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const canPublish = useCanPerform(
    'document_control',
    'update',
    'drawing.publish'
  )
  const upload = useUploadSheetRevision(projectId)
  const [file, setFile] = useState<File | null>(null)
  const [revision, setRevision] = useState('')
  const [publish, setPublish] = useState(canPublish)
  const [progress, setProgress] = useState(0)

  const submit = async () => {
    if (!file || !revision.trim()) return
    try {
      const result = await upload.mutateAsync({
        sheetId,
        file,
        revision: revision.trim(),
        publish: canPublish && publish,
        onProgress: setProgress,
      })
      toast.success(
        result.published
          ? `${sheetNumber} rev ${result.published.revision} is now current`
          : `Revision ${revision.trim().toUpperCase()} uploaded and waiting to be published`
      )
      onOpenChange(false)
      setFile(null)
      setRevision('')
      setProgress(0)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New revision of {sheetNumber}</DialogTitle>
          <DialogDescription>
            Upload the revised sheet as a PDF. Publishing makes it the current
            revision and supersedes the one the site sees today.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='sheet-revision-file'>PDF</Label>
            <Input
              id='sheet-revision-file'
              type='file'
              accept='application/pdf,.pdf'
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              data-testid='uat-sheet-revision-file'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sheet-revision-label'>Revision</Label>
            <Input
              id='sheet-revision-label'
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
              placeholder='e.g. C, 2, P3'
              maxLength={20}
              data-testid='uat-sheet-revision-label'
            />
          </div>
          {canPublish && (
            <div className='flex items-center gap-2'>
              <Switch
                id='sheet-revision-publish'
                checked={publish}
                onCheckedChange={setPublish}
              />
              <Label htmlFor='sheet-revision-publish'>
                Publish immediately
              </Label>
            </div>
          )}
          {upload.isPending && (
            <div className='h-1.5 overflow-hidden rounded bg-muted'>
              <div
                className='h-full bg-primary transition-all'
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!file || !revision.trim() || upload.isPending}
            data-testid='uat-sheet-revision-submit'
          >
            <UploadCloud className='mr-2 h-4 w-4' />
            {upload.isPending ? `Uploading ${progress}%` : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Sheet viewer: PDF.js canvas with zoom / fit / rotate, a revision picker
 * (superseded revisions only for document controllers, with a banner), a
 * new-revision upload, obsolete toggle and the sheet's discussion thread.
 */
export function SheetViewer({
  projectId,
  sheetId,
  onBack,
}: {
  projectId: string
  sheetId: string
  onBack: () => void
}) {
  const {
    data: sheet,
    isLoading,
    isError,
    error,
  } = useSheet(projectId, sheetId)
  const canManage = useCanPerform('document_control', 'update')
  const canUpload = useCanPerform(
    'document_control',
    'submit',
    'document.revision.upload'
  )
  const canPublish = useCanPerform(
    'document_control',
    'update',
    'drawing.publish'
  )
  const updateSheet = useUpdateSheet(projectId)
  const publishRevision = usePublishSheetRevision(projectId)

  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null
  )
  const [zoomIndex, setZoomIndex] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  // The render the canvas currently shows; "loading" is derived from it.
  const [rendered, setRendered] = useState<{
    key: string
    error: string | null
  }>({
    key: '',
    error: null,
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(0)

  const revisions = useMemo(() => sheet?.revisions ?? [], [sheet?.revisions])
  const revision = useMemo(() => {
    if (!sheet) return null
    return (
      revisions.find((row) => row.id === selectedRevisionId) ||
      revisions.find((row) => row.id === sheet.currentRevisionId) ||
      sheet.currentRevision ||
      revisions[0] ||
      null
    )
  }, [revisions, selectedRevisionId, sheet])

  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    const measure = () => setFrameWidth(element.clientWidth)
    const frame = requestAnimationFrame(measure)
    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(frame)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const zoom = zoomIndex === null ? null : ZOOM_STEPS[zoomIndex]
  const renderWidth = useMemo(() => {
    if (!frameWidth) return 0
    const fitWidth = Math.max(frameWidth - 16, 200)
    return zoom === null ? fitWidth : Math.round(fitWidth * zoom)
  }, [frameWidth, zoom])

  const effectiveRotation = ((revision?.rotation || 0) + rotation) % 360
  const renderKey = `${revision?.fileUrl ?? ''}|${revision?.pageNumber ?? 0}|${renderWidth}|${effectiveRotation}`
  const renderState: 'idle' | 'loading' | 'ready' | 'error' = !revision?.fileUrl
    ? 'idle'
    : rendered.key !== renderKey
      ? 'loading'
      : rendered.error
        ? 'error'
        : 'ready'
  const renderError = rendered.key === renderKey ? rendered.error : null

  useEffect(() => {
    if (!revision?.fileUrl || !canvasRef.current || !renderWidth) return
    const controller = new AbortController()
    const key = renderKey
    renderSheetPage({
      fileUrl: revision.fileUrl,
      pageNumber: revision.pageNumber,
      canvas: canvasRef.current,
      width: renderWidth,
      rotation: effectiveRotation,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted && result)
          setRendered({ key, error: null })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setRendered({
          key,
          error: err?.message || 'The sheet could not be rendered',
        })
      })
    return () => controller.abort()
  }, [
    revision?.fileUrl,
    revision?.pageNumber,
    renderWidth,
    effectiveRotation,
    renderKey,
  ])

  const zoomBy = useCallback((direction: 1 | -1) => {
    setZoomIndex((current) => {
      const base = current === null ? ZOOM_STEPS.indexOf(1) : current
      return Math.min(Math.max(base + direction, 0), ZOOM_STEPS.length - 1)
    })
  }, [])

  // Ctrl/⌘ + wheel zooms the sheet instead of the page. React registers
  // wheel listeners as passive, so a native non-passive listener is needed
  // to call preventDefault.
  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const toggleObsolete = async () => {
    if (!sheet) return
    const makingObsolete = sheet.status === 'current'
    const reason = makingObsolete
      ? (window.prompt('Why is this sheet obsolete? (optional)') ?? undefined)
      : undefined
    try {
      await updateSheet.mutateAsync({
        sheetId: sheet.id,
        status: makingObsolete ? 'obsolete' : 'current',
        obsoleteReason: reason || null,
      })
      toast.success(
        makingObsolete
          ? `${sheet.number} marked obsolete`
          : `${sheet.number} is current again`
      )
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading sheet…
      </div>
    )
  }
  if (isError || !sheet) {
    return (
      <div className='space-y-3 p-6'>
        <p className='text-sm text-destructive'>
          {getServerErrorMessage(error)}
        </p>
        <Button variant='outline' onClick={onBack}>
          <ArrowLeft className='mr-2 h-4 w-4' /> Back to sheets
        </Button>
      </div>
    )
  }

  const viewingSuperseded = Boolean(
    revision && revision.id !== sheet.currentRevisionId
  )
  const isObsolete = sheet.status === 'obsolete'

  return (
    <div className='space-y-3' data-testid='uat-sheet-viewer'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='ghost'
          size='sm'
          onClick={onBack}
          data-testid='uat-sheet-viewer-back'
        >
          <ArrowLeft className='mr-2 h-4 w-4' /> Sheets
        </Button>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-mono text-lg font-semibold'>
              {sheet.number}
            </span>
            {revision?.revision && (
              <Badge variant='outline'>Rev {revision.revision}</Badge>
            )}
            {sheet.discipline && (
              <Badge variant='secondary'>{sheet.discipline}</Badge>
            )}
            {isObsolete && <Badge variant='destructive'>Obsolete</Badge>}
          </div>
          <p className='truncate text-sm text-muted-foreground'>
            {sheet.title}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-1'>
          {revisions.length > 1 && (
            <Select
              value={revision?.id ?? ''}
              onValueChange={(value) => setSelectedRevisionId(value)}
            >
              <SelectTrigger
                className='h-8 w-[190px]'
                data-testid='uat-sheet-revision-select'
              >
                <History className='mr-2 h-3.5 w-3.5' />
                <SelectValue placeholder='Revision' />
              </SelectTrigger>
              <SelectContent>
                {revisions.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    Rev {row.revision ?? '—'} · {statusLabel(row.status)}
                    {row.publishedAt
                      ? ` · ${new Date(row.publishedAt).toLocaleDateString()}`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canUpload && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setUploadOpen(true)}
              data-testid='uat-sheet-new-revision'
            >
              <UploadCloud className='mr-2 h-4 w-4' /> New revision
            </Button>
          )}
          {canManage && (
            <Button
              size='sm'
              variant='outline'
              onClick={toggleObsolete}
              disabled={updateSheet.isPending}
            >
              {isObsolete ? 'Mark current' : 'Mark obsolete'}
            </Button>
          )}
          {revision?.fileUrl && (
            <Button asChild size='sm' variant='outline'>
              <a href={revision.fileUrl} target='_blank' rel='noreferrer'>
                <Download className='mr-2 h-4 w-4' /> PDF
              </a>
            </Button>
          )}
        </div>
      </div>

      {(viewingSuperseded ||
        isObsolete ||
        revision?.status === 'pending_review') && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm',
            'border-amber-400/60 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
          )}
          data-testid='uat-sheet-banner'
        >
          <AlertTriangle className='h-4 w-4 shrink-0' />
          {isObsolete ? (
            <span>
              This sheet is obsolete
              {sheet.obsoleteReason ? `: ${sheet.obsoleteReason}` : ''}. Do not
              build from it.
            </span>
          ) : revision?.status === 'pending_review' ? (
            <span>
              This revision is waiting to be published; the site still sees the
              previous one.
            </span>
          ) : (
            <span>
              You are viewing a superseded revision (Rev {revision?.revision}).
              The current sheet is Rev {sheet.currentRevision?.revision ?? '—'}.
            </span>
          )}
          {viewingSuperseded && sheet.currentRevisionId && (
            <Button
              size='sm'
              variant='outline'
              className='ml-auto'
              onClick={() => setSelectedRevisionId(sheet.currentRevisionId)}
            >
              Show current
            </Button>
          )}
          {revision?.status === 'pending_review' && canPublish && (
            <Button
              size='sm'
              className='ml-auto'
              disabled={publishRevision.isPending}
              onClick={() =>
                publishRevision.mutate(revision.id, {
                  onSuccess: () =>
                    toast.success(
                      `${sheet.number} rev ${revision.revision} published`
                    ),
                  onError: (err) => toast.error(getServerErrorMessage(err)),
                })
              }
            >
              Publish this revision
            </Button>
          )}
        </div>
      )}

      <div className='flex flex-wrap items-center gap-1 rounded-md border px-2 py-1'>
        <Button
          size='icon'
          variant='ghost'
          className='size-8'
          title='Zoom out'
          aria-label='Zoom out'
          onClick={() => zoomBy(-1)}
        >
          <ZoomOut className='h-4 w-4' />
        </Button>
        <span className='w-14 text-center font-mono text-xs'>
          {zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}
        </span>
        <Button
          size='icon'
          variant='ghost'
          className='size-8'
          title='Zoom in'
          aria-label='Zoom in'
          onClick={() => zoomBy(1)}
        >
          <ZoomIn className='h-4 w-4' />
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='size-8'
          title='Fit to width'
          aria-label='Fit to width'
          onClick={() => setZoomIndex(null)}
        >
          <Maximize2 className='h-4 w-4' />
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='size-8'
          title='Rotate'
          aria-label='Rotate'
          onClick={() => setRotation((value) => (value + 90) % 360)}
        >
          <RotateCw className='h-4 w-4' />
        </Button>
        <span className='ml-auto text-xs text-muted-foreground'>
          {revision
            ? [
                revision.fileName,
                revision.sizeBytes ? formatBytes(revision.sizeBytes) : null,
                revision.pageNumber > 1 ? `page ${revision.pageNumber}` : null,
                revision.width && revision.height
                  ? `${Math.round((revision.width / 72) * 25.4)} × ${Math.round((revision.height / 72) * 25.4)} mm`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'No file for this sheet yet'}
          {' · '}Ctrl + scroll to zoom
        </span>
      </div>

      <div
        ref={frameRef}
        className='relative max-h-[75vh] overflow-auto rounded-md border bg-muted/40 p-2'
        data-testid='uat-sheet-canvas-frame'
      >
        {!revision?.fileUrl ? (
          <p className='p-8 text-center text-sm text-muted-foreground'>
            This sheet has no PDF yet. Upload a revision to view it here.
          </p>
        ) : (
          <>
            {renderState === 'loading' && (
              <div className='absolute top-3 right-3 z-10 flex items-center gap-1 rounded bg-background/90 px-2 py-1 text-xs shadow'>
                <Loader2 className='h-3.5 w-3.5 animate-spin' /> Rendering…
              </div>
            )}
            {renderState === 'error' && (
              <p className='p-8 text-center text-sm text-destructive'>
                {renderError}
              </p>
            )}
            <canvas
              ref={canvasRef}
              className={cn(
                'mx-auto block bg-white shadow',
                renderState === 'error' && 'hidden'
              )}
            />
          </>
        )}
      </div>

      <CommentThread
        projectId={projectId}
        recordType='sheet'
        recordId={sheet.id}
        title={`Discussion · ${sheet.number}`}
      />

      {canUpload && (
        <RevisionUploadDialog
          projectId={projectId}
          sheetId={sheet.id}
          sheetNumber={sheet.number}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
        />
      )}
    </div>
  )
}
