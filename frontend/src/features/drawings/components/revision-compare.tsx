import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Layers, Loader2, SquareStack } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SheetRevision } from '../hooks/use-drawings'
import { renderSheetPage } from '../lib/pdf'
import { RevisionChangeSummary } from './revision-change-summary'

type Mode = 'side' | 'overlay' | 'diff'

const RENDER_WIDTH = 1400
const DIFF_THRESHOLD = 40

const renderOffscreen = async (
  revision: SheetRevision,
  width: number,
  signal: AbortSignal
) => {
  const canvas = document.createElement('canvas')
  const result = await renderSheetPage({
    fileUrl: revision.fileUrl as string,
    pageNumber: revision.pageNumber,
    canvas,
    width,
    rotation: revision.rotation,
    signal,
  })
  return result ? canvas : null
}

/**
 * Composes A and B into `target`: overlay tints A red and B blue so
 * unchanged linework turns dark and changes stay coloured; diff paints B and
 * highlights every pixel that differs from A.
 */
const compose = (
  target: HTMLCanvasElement,
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
  mode: Exclude<Mode, 'side'>,
  opacity: number
) => {
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  target.width = width
  target.height = height
  const context = target.getContext('2d')
  if (!context) return 0
  const readPixels = (source: HTMLCanvasElement) => {
    const scratch = document.createElement('canvas')
    scratch.width = width
    scratch.height = height
    const scratchContext = scratch.getContext('2d')
    if (!scratchContext) return null
    scratchContext.fillStyle = '#ffffff'
    scratchContext.fillRect(0, 0, width, height)
    scratchContext.drawImage(source, 0, 0, width, height)
    return scratchContext.getImageData(0, 0, width, height)
  }
  const pa = readPixels(a)
  const pb = readPixels(b)
  if (!pa || !pb) return 0
  const out = context.createImageData(width, height)
  let changed = 0
  for (let index = 0; index < out.data.length; index += 4) {
    const la = (pa.data[index] + pa.data[index + 1] + pa.data[index + 2]) / 3
    const lb = (pb.data[index] + pb.data[index + 1] + pb.data[index + 2]) / 3
    if (mode === 'overlay') {
      // A → red ink, B → blue ink; both → dark; blank → white.
      const inkA = (255 - la) * opacity
      const inkB = 255 - lb
      out.data[index] = 255 - inkB
      out.data[index + 1] = 255 - Math.max(inkA, inkB)
      out.data[index + 2] = 255 - inkA
      out.data[index + 3] = 255
    } else {
      const differs = Math.abs(la - lb) > DIFF_THRESHOLD
      if (differs) changed += 1
      const grey = 255 - (255 - lb) * 0.35
      out.data[index] = differs ? 220 : grey
      out.data[index + 1] = differs ? 38 : grey
      out.data[index + 2] = differs ? 38 : grey
      out.data[index + 3] = 255
    }
  }
  context.putImageData(out, 0, 0)
  return changed / (width * height)
}

const revisionLabel = (revision: SheetRevision) =>
  `Rev ${revision.revision ?? '—'} · ${revision.status.replace(/_/g, ' ')}${revision.publishedAt ? ` · ${new Date(revision.publishedAt).toLocaleDateString()}` : ''}`

/**
 * Compare two revisions of a sheet: side by side, tinted overlay, or a
 * pixel difference with the changed share of the page. Runs entirely in the
 * browser with PDF.js.
 */
export function RevisionCompare({
  revisions,
  currentRevisionId,
  projectId,
  sheetId,
}: {
  revisions: SheetRevision[]
  currentRevisionId: string | null
  /** With both, the AI "what changed" summary is offered under the compare. */
  projectId?: string
  sheetId?: string
}) {
  const withFiles = useMemo(
    () => revisions.filter((row) => row.fileUrl),
    [revisions]
  )
  const defaultB =
    withFiles.find((row) => row.id === currentRevisionId)?.id ??
    withFiles[0]?.id ??
    ''
  const defaultA = withFiles.find((row) => row.id !== defaultB)?.id ?? ''
  const [aId, setAId] = useState(defaultA)
  const [bId, setBId] = useState(defaultB)
  const [mode, setMode] = useState<Mode>('overlay')
  const [opacity, setOpacity] = useState(1)
  const [status, setStatus] = useState<{
    key: string
    changed: number | null
    error: string | null
  }>({ key: '', changed: null, error: null })
  const canvasARef = useRef<HTMLCanvasElement>(null)
  const canvasBRef = useRef<HTMLCanvasElement>(null)
  const composedRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(0)

  const a = withFiles.find((row) => row.id === aId) ?? null
  const b = withFiles.find((row) => row.id === bId) ?? null
  const key = `${a?.id}|${b?.id}|${mode}|${opacity}|${frameWidth}`
  const busy = Boolean(a && b) && status.key !== key

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
  }, [])

  useEffect(() => {
    if (!a || !b || !frameWidth) return
    const controller = new AbortController()
    const currentKey = key
    const run = async () => {
      if (mode === 'side') {
        const width = Math.max(Math.floor((frameWidth - 24) / 2), 200)
        if (!canvasARef.current || !canvasBRef.current) return
        await Promise.all([
          renderSheetPage({
            fileUrl: a.fileUrl as string,
            pageNumber: a.pageNumber,
            canvas: canvasARef.current,
            width,
            rotation: a.rotation,
            signal: controller.signal,
          }),
          renderSheetPage({
            fileUrl: b.fileUrl as string,
            pageNumber: b.pageNumber,
            canvas: canvasBRef.current,
            width,
            rotation: b.rotation,
            signal: controller.signal,
          }),
        ])
        if (!controller.signal.aborted)
          setStatus({ key: currentKey, changed: null, error: null })
        return
      }
      const [offA, offB] = await Promise.all([
        renderOffscreen(a, RENDER_WIDTH, controller.signal),
        renderOffscreen(b, RENDER_WIDTH, controller.signal),
      ])
      if (controller.signal.aborted || !offA || !offB || !composedRef.current)
        return
      const changed = compose(composedRef.current, offA, offB, mode, opacity)
      setStatus({
        key: currentKey,
        changed: mode === 'diff' ? changed : null,
        error: null,
      })
    }
    run().catch((error) => {
      if (!controller.signal.aborted)
        setStatus({
          key: currentKey,
          changed: null,
          error: error?.message || 'Compare failed',
        })
    })
    return () => controller.abort()
  }, [a, b, mode, opacity, frameWidth, key])

  if (withFiles.length < 2) {
    return (
      <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
        Compare needs two revisions with files. Superseded revisions are
        available to document controllers.
      </p>
    )
  }

  return (
    <div className='space-y-3' data-testid='uat-revision-compare'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='space-y-1'>
          <Label>Before</Label>
          <Select value={aId} onValueChange={setAId}>
            <SelectTrigger className='w-[240px]' data-testid='uat-compare-a'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withFiles.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {revisionLabel(row)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>After</Label>
          <Select value={bId} onValueChange={setBId}>
            <SelectTrigger className='w-[240px]' data-testid='uat-compare-b'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withFiles.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {revisionLabel(row)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex items-center gap-1'>
          {(
            [
              ['side', Columns2, 'Side by side'],
              ['overlay', Layers, 'Overlay'],
              ['diff', SquareStack, 'Changes'],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              size='sm'
              variant={mode === value ? 'default' : 'outline'}
              onClick={() => setMode(value)}
              data-testid={`uat-compare-${value}`}
            >
              <Icon className='mr-2 h-4 w-4' /> {label}
            </Button>
          ))}
        </div>
        {mode === 'overlay' && (
          <label className='flex items-center gap-2 text-xs text-muted-foreground'>
            Before opacity
            <input
              type='range'
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
            />
          </label>
        )}
        <span className='ml-auto flex items-center gap-2 text-xs text-muted-foreground'>
          {busy && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
          {status.error
            ? status.error
            : mode === 'overlay'
              ? 'Red = before only · Blue = after only · Dark = unchanged'
              : mode === 'diff' && status.changed !== null
                ? `${(status.changed * 100).toFixed(1)}% of the page changed`
                : ''}
        </span>
      </div>

      <div
        ref={frameRef}
        className='max-h-[75vh] overflow-auto rounded-md border bg-muted/40 p-2'
      >
        <div
          className={cn(
            'flex justify-center gap-2',
            mode !== 'side' && 'hidden'
          )}
        >
          <canvas ref={canvasARef} className='bg-white shadow' />
          <canvas ref={canvasBRef} className='bg-white shadow' />
        </div>
        <canvas
          ref={composedRef}
          className={cn(
            'mx-auto block max-w-full bg-white shadow',
            mode === 'side' && 'hidden'
          )}
        />
      </div>

      {projectId && sheetId && (
        <RevisionChangeSummary
          projectId={projectId}
          sheetId={sheetId}
          before={a}
          after={b}
        />
      )}
    </div>
  )
}
