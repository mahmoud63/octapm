import { useEffect, useRef, useState } from 'react'
import { FileWarning, ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderSheetPage } from '../lib/pdf'

interface Props {
  fileUrl: string | null
  pageNumber?: number
  rotation?: number
  width?: number
  className?: string
  /** Aspect ratio (height / width) used before the page has rendered. */
  aspect?: number
}

/**
 * Lazily renders a page of a sheet PDF when it scrolls into view. A whole
 * set shares one downloaded document, so a grid of 100 sheets costs one
 * download plus one render per visible tile.
 */
export function SheetThumbnail({
  fileUrl,
  pageNumber = 1,
  rotation = 0,
  width = 240,
  className,
  aspect = 0.7,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  // Which render (file + page + size) the canvas currently shows; the
  // "loading" state is derived from it so effects never set state directly.
  const renderKey = `${fileUrl ?? ''}|${pageNumber}|${rotation}|${width}`
  const [rendered, setRendered] = useState<{ key: string; error: boolean }>({
    key: '',
    error: false,
  })
  const state: 'idle' | 'loading' | 'ready' | 'error' = !fileUrl
    ? 'idle'
    : rendered.key !== renderKey
      ? visible
        ? 'loading'
        : 'idle'
      : rendered.error
        ? 'error'
        : 'ready'

  useEffect(() => {
    const element = containerRef.current
    if (!element || visible) return
    if (typeof IntersectionObserver === 'undefined') {
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { rootMargin: '200px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible || !fileUrl || !canvasRef.current) return
    const controller = new AbortController()
    const key = renderKey
    renderSheetPage({
      fileUrl,
      pageNumber,
      canvas: canvasRef.current,
      width,
      rotation,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted && result) {
          setRendered({ key, error: false })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setRendered({ key, error: true })
      })
    return () => controller.abort()
  }, [visible, fileUrl, pageNumber, rotation, width, renderKey])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded bg-muted',
        className
      )}
      style={{ minHeight: Math.round(width * aspect) }}
    >
      {!fileUrl ? (
        <span className='flex flex-col items-center gap-1 text-xs text-muted-foreground'>
          <ImageOff className='h-5 w-5' />
          No file
        </span>
      ) : state === 'error' ? (
        <span className='flex flex-col items-center gap-1 text-xs text-muted-foreground'>
          <FileWarning className='h-5 w-5' />
          Preview unavailable
        </span>
      ) : null}
      <canvas
        ref={canvasRef}
        className={cn('block max-w-full', state !== 'ready' && 'hidden')}
        aria-hidden={state !== 'ready'}
      />
      {fileUrl && state === 'loading' && (
        <div className='absolute inset-0 animate-pulse bg-muted' />
      )}
    </div>
  )
}
