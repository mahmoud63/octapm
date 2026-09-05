import { useCallback, useRef, useState, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import type {
  Markup,
  MarkupPoint,
  MarkupShape,
  MarkupShapeType,
  Pin,
} from '../hooks/use-markups'
import {
  arrowHead,
  cloudPath,
  hitTest,
  measureLabel,
  newShapeId,
  toNormalized,
  toPixels,
  type ScaleInfo,
} from '../lib/geometry'

export type MarkupTool =
  | 'view'
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'polyline'
  | 'cloud'
  | 'highlight'
  | 'text'
  | 'measure'
  | 'pin'

const PIN_COLORS: Record<string, string> = {
  rfi: '#2563eb',
  defect: '#dc2626',
  photo: '#0d9488',
  ncr: '#b91c1c',
  submittal: '#7c3aed',
  task: '#d97706',
  safety_incident: '#ea580c',
  itp: '#0891b2',
  correspondence: '#4b5563',
}

interface Props {
  width: number
  height: number
  scale: ScaleInfo
  tool: MarkupTool
  color: string
  strokeWidth: number
  /** Layers to draw (published + others); the editable layer is passed separately. */
  layers: Markup[]
  hiddenLayerIds: Set<string>
  myShapes: MarkupShape[]
  onMyShapesChange: (shapes: MarkupShape[]) => void
  selectedShapeId: string | null
  onSelectShape: (id: string | null) => void
  pins: Pin[]
  showPins: boolean
  highlightedPinId?: string | null
  onPinPlace: (point: MarkupPoint) => void
  onPinClick: (pin: Pin) => void
  className?: string
}

type Draft =
  | {
      type: 'box'
      shapeType: MarkupShapeType
      start: MarkupPoint
      current: MarkupPoint
    }
  | {
      type: 'segment'
      shapeType: MarkupShapeType
      start: MarkupPoint
      current: MarkupPoint
    }
  | { type: 'path'; points: MarkupPoint[] }

const BOX_TOOLS = new Set<MarkupTool>(['rect', 'ellipse', 'cloud', 'highlight'])
const SEGMENT_TOOLS = new Set<MarkupTool>(['arrow', 'line', 'measure'])

function ShapeSvg({
  shape,
  width,
  height,
  scale,
  selected,
  dimmed,
}: {
  shape: MarkupShape
  width: number
  height: number
  scale: ScaleInfo
  selected?: boolean
  dimmed?: boolean
}) {
  const stroke = shape.color
  const strokeWidth = shape.strokeWidth
  const common = {
    stroke,
    strokeWidth,
    fill: 'none',
    opacity: dimmed ? 0.45 : 1,
    style: selected
      ? { filter: 'drop-shadow(0 0 3px rgba(37,99,235,0.9))' }
      : undefined,
  }
  if (shape.points?.length) {
    const pixels = shape.points.map((point) => toPixels(point, width, height))
    if (shape.type === 'polyline') {
      return (
        <polyline
          {...common}
          points={pixels.map((p) => `${p.x},${p.y}`).join(' ')}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      )
    }
    const [a, b] = pixels
    if (!a || !b) return null
    const label =
      shape.type === 'measure'
        ? shape.label || measureLabel(shape.points[0], shape.points[1], scale)
        : null
    return (
      <g opacity={common.opacity} style={common.style}>
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap='round'
        />
        {shape.type === 'arrow' && (
          <polygon
            points={arrowHead(a, b, 6 + strokeWidth * 2)}
            fill={stroke}
          />
        )}
        {shape.type === 'measure' && (
          <>
            <circle cx={a.x} cy={a.y} r={3} fill={stroke} />
            <circle cx={b.x} cy={b.y} r={3} fill={stroke} />
            {label && (
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 6}
                textAnchor='middle'
                fontSize={12}
                fill={stroke}
                stroke='white'
                strokeWidth={3}
                paintOrder='stroke'
                fontFamily='ui-sans-serif, system-ui'
              >
                {label}
              </text>
            )}
          </>
        )}
      </g>
    )
  }
  const x = (shape.x ?? 0) * width
  const y = (shape.y ?? 0) * height
  const w = (shape.w ?? 0) * width
  const h = (shape.h ?? 0) * height
  const nx = Math.min(x, x + w)
  const ny = Math.min(y, y + h)
  const nw = Math.abs(w)
  const nh = Math.abs(h)
  switch (shape.type) {
    case 'rect':
      return (
        <rect
          {...common}
          x={nx}
          y={ny}
          width={nw}
          height={nh}
          fill={shape.fill ? stroke : 'none'}
          fillOpacity={shape.fill ? 0.15 : undefined}
        />
      )
    case 'ellipse':
      return (
        <ellipse
          {...common}
          cx={nx + nw / 2}
          cy={ny + nh / 2}
          rx={nw / 2}
          ry={nh / 2}
        />
      )
    case 'highlight':
      return (
        <rect
          x={nx}
          y={ny}
          width={nw}
          height={nh}
          fill={stroke}
          fillOpacity={dimmed ? 0.15 : 0.3}
          stroke='none'
          style={common.style}
        />
      )
    case 'cloud':
      return (
        <path
          {...common}
          d={cloudPath(nx, ny, nw, nh)}
          strokeLinejoin='round'
        />
      )
    case 'text': {
      const fontSize = (shape.fontSize ?? 14) * (width / 1000)
      return (
        <text
          x={nx}
          y={ny + fontSize}
          fontSize={Math.max(fontSize, 8)}
          fill={stroke}
          stroke='white'
          strokeWidth={3}
          paintOrder='stroke'
          fontFamily='ui-sans-serif, system-ui'
          opacity={common.opacity}
          style={common.style}
        >
          {shape.text}
        </text>
      )
    }
    default:
      return null
  }
}

function PinMarker({
  pin,
  width,
  height,
  highlighted,
  onClick,
}: {
  pin: Pin
  width: number
  height: number
  highlighted?: boolean
  onClick: () => void
}) {
  const { x, y } = toPixels(pin, width, height)
  const color = pin.color || PIN_COLORS[pin.recordType] || '#2563eb'
  const letter = (pin.recordLabel || pin.recordType).charAt(0).toUpperCase()
  const closed =
    pin.record?.status &&
    ['closed', 'answered', 'approved', 'done'].includes(pin.record.status)
  return (
    <g
      transform={`translate(${x} ${y})`}
      className='cursor-pointer'
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      data-testid='uat-sheet-pin'
    >
      {highlighted && <circle r={20} fill={color} fillOpacity={0.25} />}
      <path
        d='M0 0 L-10 -14 A12 12 0 1 1 10 -14 Z'
        fill={color}
        stroke='white'
        strokeWidth={2}
        opacity={closed ? 0.6 : 1}
      />
      <text
        y={-16}
        textAnchor='middle'
        fontSize={11}
        fontWeight={700}
        fill='white'
        fontFamily='ui-sans-serif, system-ui'
      >
        {letter}
      </text>
    </g>
  )
}

/**
 * SVG overlay over the rendered sheet: draws every visible layer, the
 * editable personal layer, pins, and handles the drawing tools.
 */
export function MarkupLayer({
  width,
  height,
  scale,
  tool,
  color,
  strokeWidth,
  layers,
  hiddenLayerIds,
  myShapes,
  onMyShapesChange,
  selectedShapeId,
  onSelectShape,
  pins,
  showPins,
  highlightedPinId,
  onPinPlace,
  onPinClick,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const drawing = tool !== 'view'

  const pointFromEvent = useCallback(
    (event: PointerEvent<SVGSVGElement>): MarkupPoint => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return toNormalized(
        event.clientX - rect.left,
        event.clientY - rect.top,
        width,
        height
      )
    },
    [width, height]
  )

  const pixelFromEvent = (event: PointerEvent<SVGSVGElement>): MarkupPoint => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const commit = (shape: MarkupShape) => {
    onMyShapesChange([...myShapes, shape])
    onSelectShape(shape.id)
  }

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing || event.button !== 0) return
    const point = pointFromEvent(event)
    if (tool === 'select') {
      const pixel = pixelFromEvent(event)
      const hit = [...myShapes]
        .reverse()
        .find((shape) => hitTest(shape, pixel, width, height))
      onSelectShape(hit?.id ?? null)
      return
    }
    if (tool === 'pin') {
      onPinPlace(point)
      return
    }
    if (tool === 'text') {
      const text = window.prompt('Text')
      if (text?.trim()) {
        commit({
          id: newShapeId('text'),
          type: 'text',
          color,
          strokeWidth,
          x: point.x,
          y: point.y,
          w: 0.2,
          h: 0.04,
          text: text.trim().slice(0, 500),
          fontSize: 14,
        })
      }
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (BOX_TOOLS.has(tool)) {
      setDraft({
        type: 'box',
        shapeType: tool as MarkupShapeType,
        start: point,
        current: point,
      })
    } else if (SEGMENT_TOOLS.has(tool)) {
      setDraft({
        type: 'segment',
        shapeType: tool as MarkupShapeType,
        start: point,
        current: point,
      })
    } else if (tool === 'polyline') {
      setDraft({ type: 'path', points: [point] })
    }
  }

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!draft) return
    const point = pointFromEvent(event)
    setDraft((current) => {
      if (!current) return current
      if (current.type === 'path') {
        const last = current.points[current.points.length - 1]
        if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.002)
          return current
        return { ...current, points: [...current.points, point] }
      }
      return { ...current, current: point }
    })
  }

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!draft) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const finished = draft
    setDraft(null)
    if (finished.type === 'box') {
      const w = finished.current.x - finished.start.x
      const h = finished.current.y - finished.start.y
      if (Math.abs(w) < 0.004 && Math.abs(h) < 0.004) return
      commit({
        id: newShapeId(finished.shapeType),
        type: finished.shapeType,
        color,
        strokeWidth,
        x: Math.min(finished.start.x, finished.current.x),
        y: Math.min(finished.start.y, finished.current.y),
        w: Math.abs(w),
        h: Math.abs(h),
      })
    } else if (finished.type === 'segment') {
      if (
        Math.hypot(
          finished.current.x - finished.start.x,
          finished.current.y - finished.start.y
        ) < 0.004
      )
        return
      commit({
        id: newShapeId(finished.shapeType),
        type: finished.shapeType,
        color,
        strokeWidth,
        points: [finished.start, finished.current],
        label:
          finished.shapeType === 'measure'
            ? measureLabel(finished.start, finished.current, scale)
            : undefined,
      })
    } else if (finished.points.length >= 2) {
      commit({
        id: newShapeId('polyline'),
        type: 'polyline',
        color,
        strokeWidth,
        points: finished.points,
      })
    }
  }

  const draftShape: MarkupShape | null = draft
    ? draft.type === 'box'
      ? {
          id: 'draft',
          type: draft.shapeType,
          color,
          strokeWidth,
          x: Math.min(draft.start.x, draft.current.x),
          y: Math.min(draft.start.y, draft.current.y),
          w: Math.abs(draft.current.x - draft.start.x),
          h: Math.abs(draft.current.y - draft.start.y),
        }
      : draft.type === 'segment'
        ? {
            id: 'draft',
            type: draft.shapeType,
            color,
            strokeWidth,
            points: [draft.start, draft.current],
          }
        : {
            id: 'draft',
            type: 'polyline',
            color,
            strokeWidth,
            points: draft.points,
          }
    : null

  const cursor =
    tool === 'view'
      ? 'default'
      : tool === 'select'
        ? 'pointer'
        : tool === 'pin'
          ? 'cell'
          : tool === 'text'
            ? 'text'
            : 'crosshair'

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('absolute top-0 left-0 touch-none select-none', className)}
      style={{ cursor, pointerEvents: drawing ? 'auto' : 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDraft(null)}
      data-testid='uat-markup-layer'
    >
      {layers
        .filter((layer) => !hiddenLayerIds.has(layer.id))
        .map((layer) => (
          <g key={layer.id} data-layer={layer.id}>
            {layer.shapes.map((shape) => (
              <ShapeSvg
                key={shape.id}
                shape={shape}
                width={width}
                height={height}
                scale={scale}
                dimmed
              />
            ))}
          </g>
        ))}
      <g data-layer='mine'>
        {myShapes.map((shape) => (
          <ShapeSvg
            key={shape.id}
            shape={shape}
            width={width}
            height={height}
            scale={scale}
            selected={shape.id === selectedShapeId}
          />
        ))}
        {draftShape && (
          <ShapeSvg
            shape={draftShape}
            width={width}
            height={height}
            scale={scale}
          />
        )}
      </g>
      {showPins && (
        <g data-layer='pins' style={{ pointerEvents: 'auto' }}>
          {pins.map((pin) => (
            <PinMarker
              key={pin.id}
              pin={pin}
              width={width}
              height={height}
              highlighted={pin.id === highlightedPinId}
              onClick={() => onPinClick(pin)}
            />
          ))}
        </g>
      )}
    </svg>
  )
}
