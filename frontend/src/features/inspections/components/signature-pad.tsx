import { useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Finger / mouse signature capture. Exports a PNG data URL trimmed to a
 * modest size (the server caps signatures at 400 KB).
 */
export function SignaturePad({
  onChange,
  width = 480,
  height = 160,
  disabled = false,
}: {
  onChange: (dataUrl: string | null) => void
  width?: number
  height?: number
  disabled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    drawing.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    const { x, y } = point(event)
    context.lineWidth = 2.2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#111827'
    context.beginPath()
    context.moveTo(x, y)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const { x, y } = point(event)
    context.lineTo(x, y)
    context.stroke()
    if (!hasInk) setHasInk(true)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(canvas.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className='space-y-2'>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className='w-full touch-none rounded border bg-white'
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        aria-label='Signature area'
        data-testid='uat-signature-pad'
      />
      <div className='flex items-center justify-between text-xs text-muted-foreground'>
        <span>
          {hasInk ? 'Signed above' : 'Sign with a finger or the mouse'}
        </span>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={clear}
          disabled={disabled || !hasInk}
        >
          <Eraser className='mr-1.5 h-3.5 w-3.5' /> Clear
        </Button>
      </div>
    </div>
  )
}
