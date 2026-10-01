import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Circle,
  Cloud,
  Download,
  Eye,
  EyeOff,
  GitCompareArrows,
  Highlighter,
  History,
  Loader2,
  MapPin,
  Maximize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  PenTool,
  RotateCw,
  Ruler,
  Share2,
  Square,
  Trash2,
  Type,
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
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { CommentThread } from '@/features/comments/components/comment-thread'
import {
  formatBytes,
  usePublishSheetRevision,
  useSheet,
  useUpdateSheet,
  useUploadSheetRevision,
  type SheetRevision,
} from '../hooks/use-drawings'
import {
  useDeleteMarkup,
  usePublishMarkup,
  useSaveMyMarkup,
  useSheetMarkups,
  useSheetPins,
  type MarkupPoint,
  type MarkupShape,
  type Pin,
} from '../hooks/use-markups'
import { renderSheetPage } from '../lib/pdf'
import { MarkupLayer, type MarkupTool } from './markup-layer'
import { PinCreateDialog, PinDetailDialog } from './pin-dialog'
import { RaiseChangeEventButton } from '@/features/controls/exceptions/raise-change-event-button'
import { RevisionCompare } from './revision-compare'
import { SheetReferencesPanel } from './sheet-references'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const AUTOSAVE_MS = 800
const MARKUP_COLORS = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#111827',
]

type ViewerMode = 'view' | 'markup' | 'pins' | 'compare'

const TOOLS: Array<{ tool: MarkupTool; label: string; Icon: typeof Square }> = [
  { tool: 'select', label: 'Select', Icon: MousePointer2 },
  { tool: 'rect', label: 'Rectangle', Icon: Square },
  { tool: 'ellipse', label: 'Ellipse', Icon: Circle },
  { tool: 'cloud', label: 'Revision cloud', Icon: Cloud },
  { tool: 'arrow', label: 'Arrow', Icon: MoveUpRight },
  { tool: 'line', label: 'Line', Icon: Minus },
  { tool: 'polyline', label: 'Freehand', Icon: PenLine },
  { tool: 'highlight', label: 'Highlight', Icon: Highlighter },
  { tool: 'text', label: 'Text', Icon: Type },
  { tool: 'measure', label: 'Measure', Icon: Ruler },
]

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
 * Sheet viewer: PDF.js canvas with zoom / fit / rotate, a markup layer
 * (personal until published), pins that raise or link records, revision
 * compare, a revision picker with superseded / pending / obsolete banners,
 * new-revision upload, and the sheet's discussion and activity.
 */
export function SheetViewer({
  projectId,
  sheetId,
  initialPinId = null,
  onBack,
  onOpenSheet,
}: {
  projectId: string
  sheetId: string
  initialPinId?: string | null
  onBack: () => void
  /** Opens another sheet (a cross-reference) in this viewer. */
  onOpenSheet?: (sheetId: string) => void
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
  const canPublishMarkup = useCanPerform('document_control', 'create')
  const updateSheet = useUpdateSheet(projectId)
  const publishRevision = usePublishSheetRevision(projectId)

  const { data: markupData } = useSheetMarkups(projectId, sheetId)
  const { data: pinData } = useSheetPins(projectId, sheetId)
  const saveMyMarkup = useSaveMyMarkup(projectId, sheetId)
  const publishMarkup = usePublishMarkup(projectId, sheetId)
  const deleteMarkup = useDeleteMarkup(projectId, sheetId)

  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null
  )
  const [zoomIndex, setZoomIndex] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [mode, setMode] = useState<ViewerMode>(initialPinId ? 'pins' : 'view')
  const [tool, setTool] = useState<MarkupTool>('rect')
  const [color, setColor] = useState(MARKUP_COLORS[0])
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null)
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set())
  const [showPins, setShowPins] = useState(true)
  const [pinPoint, setPinPoint] = useState<MarkupPoint | null>(null)
  const [activePin, setActivePin] = useState<Pin | null>(null)
  // Local edits to my layer; `dirty` means they are not yet on the server.
  const [draft, setDraft] = useState<{ shapes: MarkupShape[]; dirty: boolean }>(
    { shapes: [], dirty: false }
  )
  // The render the canvas currently shows; "loading" is derived from it.
  const [rendered, setRendered] = useState<{
    key: string
    error: string | null
    size: { width: number; height: number } | null
  }>({ key: '', error: null, size: null })
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

  const markups = useMemo(() => markupData?.items ?? [], [markupData?.items])
  const myLayer = useMemo(
    () =>
      markups.find((item) => item.isMine && item.visibility === 'personal') ??
      null,
    [markups]
  )
  const otherLayers = useMemo(
    () => markups.filter((item) => item !== myLayer),
    [markups, myLayer]
  )
  const myShapes = useMemo(
    () => (draft.dirty ? draft.shapes : (myLayer?.shapes ?? [])),
    [draft.dirty, draft.shapes, myLayer?.shapes]
  )
  const pins = useMemo(() => pinData?.items ?? [], [pinData?.items])

  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    const measure = () => setFrameWidth(element.clientWidth)
    const frame = requestAnimationFrame(measure)
    if (typeof ResizeObserver === 'undefined')
      return () => cancelAnimationFrame(frame)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [mode])

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
  const pageSize = rendered.key === renderKey ? rendered.size : null

  useEffect(() => {
    if (mode === 'compare') return
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
        if (!controller.signal.aborted && result) {
          setRendered({
            key,
            error: null,
            size: { width: result.width, height: result.height },
          })
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setRendered({
          key,
          error: err?.message || 'The sheet could not be rendered',
          size: null,
        })
      })
    return () => controller.abort()
  }, [
    revision?.fileUrl,
    revision?.pageNumber,
    renderWidth,
    effectiveRotation,
    renderKey,
    mode,
  ])

  // Auto-save my layer shortly after the last edit.
  useEffect(() => {
    if (!draft.dirty) return
    const timer = window.setTimeout(() => {
      saveMyMarkup.mutate(
        { shapes: draft.shapes, sheetRevisionId: revision?.id ?? null },
        {
          onSuccess: () =>
            setDraft((current) =>
              current.shapes === draft.shapes
                ? { ...current, dirty: false }
                : current
            ),
          onError: (err) => toast.error(getServerErrorMessage(err)),
        }
      )
    }, AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const changeMyShapes = useCallback(
    (shapes: MarkupShape[]) => setDraft({ shapes, dirty: true }),
    []
  )

  const removeSelected = useCallback(() => {
    if (!selectedShapeId) return
    changeMyShapes(myShapes.filter((shape) => shape.id !== selectedShapeId))
    setSelectedShapeId(null)
  }, [changeMyShapes, myShapes, selectedShapeId])

  useEffect(() => {
    if (mode !== 'markup') return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelected()
      } else if (event.key === 'Escape') {
        setSelectedShapeId(null)
        setTool('select')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, removeSelected])

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
  }, [zoomBy, mode])

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

  const setScale = async () => {
    if (!sheet) return
    const answer = window.prompt(
      'Drawing scale denominator (e.g. 100 for 1:100). Leave empty to clear.',
      sheet.scaleRatio ? String(sheet.scaleRatio) : ''
    )
    if (answer === null) return
    const ratio = answer.trim()
      ? Number(answer.trim().replace(/^1\s*:\s*/, ''))
      : null
    if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0)) {
      toast.error('Enter a positive number, e.g. 100 for 1:100')
      return
    }
    try {
      await updateSheet.mutateAsync({
        sheetId: sheet.id,
        scaleRatio: ratio,
      })
      toast.success(ratio ? `Scale set to 1:${ratio}` : 'Scale cleared')
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  const publishMyLayer = () => {
    if (!myLayer || !myShapes.length) return
    const name = window.prompt(
      'Name this markup for the team',
      myLayer.name ?? ''
    )
    if (name === null) return
    publishMarkup.mutate(
      { markupId: myLayer.id, name: name.trim() || null },
      {
        onSuccess: () => {
          setDraft({ shapes: [], dirty: false })
          toast.success('Markup published to the project')
        },
        onError: (err) => toast.error(getServerErrorMessage(err)),
      }
    )
  }

  const toggleLayer = (id: string) =>
    setHiddenLayerIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
  const layerTool: MarkupTool =
    mode === 'markup' ? tool : mode === 'pins' ? 'pin' : 'view'
  const scale = {
    pageWidthPt: revision?.width ?? null,
    pageHeightPt: revision?.height ?? null,
    scaleRatio: sheet.scaleRatio ?? null,
  }

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
            {sheet.scaleRatio && (
              <Badge variant='outline'>1:{sheet.scaleRatio}</Badge>
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
          {/* PC-7b: a draft change event prefilled from the revision on screen (typed link). */}
          {revision?.id && (
            <RaiseChangeEventButton
              projectId={projectId}
              source={{ type: 'drawing_revision', id: revision.id }}
              testId='uat-sheet-raise-change-event'
            />
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
          {canManage && (
            <Button
              size='sm'
              variant='outline'
              onClick={setScale}
              disabled={updateSheet.isPending}
              data-testid='uat-sheet-set-scale'
            >
              <Ruler className='mr-2 h-4 w-4' /> Scale
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

      <div
        className='flex flex-wrap items-center gap-1 rounded-md border px-2 py-1'
        data-testid='uat-sheet-modes'
      >
        {(
          [
            ['view', Eye, 'View'],
            ['markup', PenTool, 'Markup'],
            ['pins', MapPin, 'Pins'],
            ['compare', GitCompareArrows, 'Compare'],
          ] as const
        ).map(([value, Icon, label]) => (
          <Button
            key={value}
            size='sm'
            variant={mode === value ? 'default' : 'ghost'}
            onClick={() => {
              setMode(value)
              setSelectedShapeId(null)
            }}
            data-testid={`uat-sheet-mode-${value}`}
          >
            <Icon className='mr-2 h-4 w-4' /> {label}
          </Button>
        ))}
        <span className='mx-1 h-5 w-px bg-border' />
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
        <Button
          size='sm'
          variant='ghost'
          className='h-8'
          title={showPins ? 'Hide pins' : 'Show pins'}
          onClick={() => setShowPins((value) => !value)}
          data-testid='uat-sheet-toggle-pins'
        >
          {showPins ? (
            <Eye className='mr-1 h-4 w-4' />
          ) : (
            <EyeOff className='mr-1 h-4 w-4' />
          )}
          {pins.length} pin{pins.length === 1 ? '' : 's'}
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

      {mode === 'markup' && (
        <div
          className='flex flex-wrap items-center gap-1 rounded-md border px-2 py-1'
          data-testid='uat-markup-tools'
        >
          {TOOLS.map(({ tool: value, label, Icon }) => (
            <Button
              key={value}
              size='icon'
              variant={tool === value ? 'default' : 'ghost'}
              className='size-8'
              title={label}
              aria-label={label}
              onClick={() => setTool(value)}
              data-testid={`uat-markup-tool-${value}`}
            >
              <Icon className='h-4 w-4' />
            </Button>
          ))}
          <span className='mx-1 h-5 w-px bg-border' />
          {MARKUP_COLORS.map((value) => (
            <button
              key={value}
              type='button'
              aria-label={`Colour ${value}`}
              className={cn(
                'size-5 rounded-full border-2',
                color === value ? 'border-foreground' : 'border-transparent'
              )}
              style={{ backgroundColor: value }}
              onClick={() => setColor(value)}
            />
          ))}
          <Select
            value={String(strokeWidth)}
            onValueChange={(value) => setStrokeWidth(Number(value))}
          >
            <SelectTrigger className='ml-1 h-8 w-[90px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 4, 6].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value === 1
                    ? 'Thin'
                    : value === 2
                      ? 'Normal'
                      : value === 4
                        ? 'Bold'
                        : 'Heavy'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className='mx-1 h-5 w-px bg-border' />
          <Button
            size='sm'
            variant='ghost'
            className='h-8'
            disabled={!selectedShapeId}
            onClick={removeSelected}
          >
            <Trash2 className='mr-1 h-4 w-4' /> Delete
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='h-8'
            disabled={!myShapes.length}
            onClick={() => {
              if (window.confirm('Clear your markup on this sheet?'))
                changeMyShapes([])
            }}
          >
            Clear mine
          </Button>
          {canPublishMarkup && (
            <Button
              size='sm'
              className='h-8'
              disabled={
                !myShapes.length || draft.dirty || publishMarkup.isPending
              }
              onClick={publishMyLayer}
              data-testid='uat-markup-publish'
            >
              <Share2 className='mr-1 h-4 w-4' /> Publish to project
            </Button>
          )}
          <span className='ml-auto text-xs text-muted-foreground'>
            {draft.dirty || saveMyMarkup.isPending
              ? 'Saving…'
              : myShapes.length
                ? `${myShapes.length} shape${myShapes.length === 1 ? '' : 's'} · saved, only you can see them`
                : 'Draw on the sheet; only you can see your markup until you publish it'}
            {!sheet.scaleRatio && tool === 'measure'
              ? ' · set the scale to measure real distances'
              : ''}
          </span>
        </div>
      )}

      {mode === 'pins' && (
        <p
          className='rounded-md border px-3 py-2 text-sm text-muted-foreground'
          data-testid='uat-pin-hint'
        >
          Click on the sheet to drop a pin: raise an RFI right there, link an
          existing RFI or defect, or attach a photo. Pins follow the sheet
          through every revision.
        </p>
      )}

      {otherLayers.length > 0 && mode !== 'compare' && (
        <div
          className='flex flex-wrap items-center gap-2 text-xs'
          data-testid='uat-markup-layers'
        >
          <span className='text-muted-foreground'>Layers</span>
          {otherLayers.map((layer) => (
            <span
              key={layer.id}
              className='inline-flex items-center gap-1 rounded border px-2 py-0.5'
            >
              <button
                type='button'
                className='inline-flex items-center gap-1'
                onClick={() => toggleLayer(layer.id)}
                title={
                  hiddenLayerIds.has(layer.id) ? 'Show layer' : 'Hide layer'
                }
              >
                {hiddenLayerIds.has(layer.id) ? (
                  <EyeOff className='h-3.5 w-3.5' />
                ) : (
                  <Eye className='h-3.5 w-3.5' />
                )}
                {layer.name || 'Markup'} · {layer.authorName || 'Unknown'} ·{' '}
                {layer.shapeCount}
              </button>
              {layer.canEdit && (
                <button
                  type='button'
                  className='text-destructive'
                  title='Remove layer'
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove the layer "${layer.name || 'Markup'}"?`
                      )
                    ) {
                      deleteMarkup.mutate(layer.id, {
                        onError: (err) =>
                          toast.error(getServerErrorMessage(err)),
                      })
                    }
                  }}
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {mode !== 'compare' && (
        <SheetReferencesPanel
          projectId={projectId}
          sheetId={sheet.id}
          onOpenSheet={onOpenSheet}
        />
      )}

      {mode === 'compare' ? (
        <RevisionCompare
          revisions={revisions}
          currentRevisionId={sheet.currentRevisionId}
          projectId={projectId}
          sheetId={sheet.id}
        />
      ) : (
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
              <div
                className={cn(
                  'relative mx-auto',
                  renderState === 'error' && 'hidden'
                )}
                style={
                  pageSize
                    ? { width: pageSize.width, height: pageSize.height }
                    : undefined
                }
              >
                <canvas ref={canvasRef} className='block bg-white shadow' />
                {pageSize && renderState === 'ready' && (
                  <MarkupLayer
                    width={pageSize.width}
                    height={pageSize.height}
                    scale={scale}
                    tool={layerTool}
                    color={color}
                    strokeWidth={strokeWidth}
                    layers={otherLayers}
                    hiddenLayerIds={hiddenLayerIds}
                    myShapes={myShapes}
                    onMyShapesChange={changeMyShapes}
                    selectedShapeId={selectedShapeId}
                    onSelectShape={setSelectedShapeId}
                    pins={pins}
                    showPins={showPins}
                    highlightedPinId={initialPinId}
                    onPinPlace={setPinPoint}
                    onPinClick={setActivePin}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}

      <CommentThread
        projectId={projectId}
        recordType='sheet'
        recordId={sheet.id}
        title={`Discussion · ${sheet.number}`}
      />
      <HistoryPanel
        projectId={projectId}
        entityType='sheet'
        entityId={sheet.id}
        title={`${sheet.number} activity`}
        limit={30}
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
      <PinCreateDialog
        projectId={projectId}
        sheetId={sheet.id}
        sheetNumber={sheet.number}
        sheetRevisionId={revision?.id ?? null}
        point={pinPoint}
        onOpenChange={(open) => {
          if (!open) setPinPoint(null)
        }}
      />
      <PinDetailDialog
        projectId={projectId}
        pin={activePin}
        onOpenChange={(open) => {
          if (!open) setActivePin(null)
        }}
      />
    </div>
  )
}
