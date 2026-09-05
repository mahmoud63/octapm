import type { MarkupPoint, MarkupShape } from '../hooks/use-markups'

/**
 * Markup geometry. Shapes are stored with 0..1 coordinates relative to the
 * page so they sit in the same place on every revision and at every zoom.
 */

export const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

export const toPixels = (
  point: MarkupPoint,
  width: number,
  height: number
) => ({
  x: point.x * width,
  y: point.y * height,
})

export const toNormalized = (
  px: number,
  py: number,
  width: number,
  height: number
): MarkupPoint => ({
  x: clamp01(width ? px / width : 0),
  y: clamp01(height ? py / height : 0),
})

export const distance = (a: MarkupPoint, b: MarkupPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/** Axis-aligned bounds of a shape in normalised units. */
export const shapeBounds = (shape: MarkupShape) => {
  if (shape.points?.length) {
    const xs = shape.points.map((point) => point.x)
    const ys = shape.points.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  const w = shape.w ?? 0
  const h = shape.h ?? 0
  return {
    x: Math.min(shape.x ?? 0, (shape.x ?? 0) + w),
    y: Math.min(shape.y ?? 0, (shape.y ?? 0) + h),
    w: Math.abs(w),
    h: Math.abs(h),
  }
}

/** Distance from a point to a segment, all in pixels. */
const segmentDistance = (p: MarkupPoint, a: MarkupPoint, b: MarkupPoint) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared
    ? clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)
    : 0
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/**
 * Whether a pixel point hits a shape (with a tolerance in pixels). Lines and
 * polylines test distance to their segments; boxes test their outline or
 * interior (text and highlights are solid targets).
 */
export const hitTest = (
  shape: MarkupShape,
  point: MarkupPoint,
  width: number,
  height: number,
  tolerance = 8
) => {
  if (shape.points?.length) {
    const pixels = shape.points.map((p) => toPixels(p, width, height))
    for (let index = 0; index < pixels.length - 1; index += 1) {
      if (
        segmentDistance(point, pixels[index], pixels[index + 1]) <= tolerance
      ) {
        return true
      }
    }
    return false
  }
  const bounds = shapeBounds(shape)
  const x = bounds.x * width
  const y = bounds.y * height
  const w = bounds.w * width
  const h = bounds.h * height
  const inside =
    point.x >= x - tolerance &&
    point.x <= x + w + tolerance &&
    point.y >= y - tolerance &&
    point.y <= y + h + tolerance
  if (!inside) return false
  if (shape.type === 'text' || shape.type === 'highlight' || shape.fill)
    return true
  const nearEdge =
    Math.abs(point.x - x) <= tolerance ||
    Math.abs(point.x - (x + w)) <= tolerance ||
    Math.abs(point.y - y) <= tolerance ||
    Math.abs(point.y - (y + h)) <= tolerance
  return nearEdge || (w < tolerance * 3 && h < tolerance * 3)
}

/** Arrow-head polygon (pixels) for a segment ending at `b`. */
export const arrowHead = (a: MarkupPoint, b: MarkupPoint, size = 12) => {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const left = {
    x: b.x - size * Math.cos(angle - Math.PI / 7),
    y: b.y - size * Math.sin(angle - Math.PI / 7),
  }
  const right = {
    x: b.x - size * Math.cos(angle + Math.PI / 7),
    y: b.y - size * Math.sin(angle + Math.PI / 7),
  }
  return `${b.x},${b.y} ${left.x},${left.y} ${right.x},${right.y}`
}

/** Revision-cloud outline (pixels): arcs along a rectangle. */
export const cloudPath = (x: number, y: number, w: number, h: number) => {
  const bump = Math.max(8, Math.min(18, Math.min(w, h) / 4))
  const across = Math.max(2, Math.round(w / bump))
  const down = Math.max(2, Math.round(h / bump))
  const sx = w / across
  const sy = h / down
  let path = `M ${x} ${y}`
  for (let index = 0; index < across; index += 1) {
    path += ` A ${sx / 2} ${sx / 2} 0 0 1 ${x + (index + 1) * sx} ${y}`
  }
  for (let index = 0; index < down; index += 1) {
    path += ` A ${sy / 2} ${sy / 2} 0 0 1 ${x + w} ${y + (index + 1) * sy}`
  }
  for (let index = across; index > 0; index -= 1) {
    path += ` A ${sx / 2} ${sx / 2} 0 0 1 ${x + (index - 1) * sx} ${y + h}`
  }
  for (let index = down; index > 0; index -= 1) {
    path += ` A ${sy / 2} ${sy / 2} 0 0 1 ${x} ${y + (index - 1) * sy}`
  }
  return `${path} Z`
}

export interface ScaleInfo {
  /** Page size in PDF points (1/72 in). */
  pageWidthPt: number | null
  pageHeightPt: number | null
  /** Drawing scale denominator, e.g. 100 for 1:100. */
  scaleRatio: number | null
}

const PT_TO_MM = 25.4 / 72

/**
 * Human label for a measured segment. With a sheet scale the label is the
 * real-world length; without one it is the length on paper.
 */
export const measureLabel = (
  a: MarkupPoint,
  b: MarkupPoint,
  scale: ScaleInfo
) => {
  if (!scale.pageWidthPt || !scale.pageHeightPt) return null
  const dx = (a.x - b.x) * scale.pageWidthPt
  const dy = (a.y - b.y) * scale.pageHeightPt
  const paperMm = Math.hypot(dx, dy) * PT_TO_MM
  if (!scale.scaleRatio) return `${paperMm.toFixed(0)} mm on paper`
  const realMm = paperMm * scale.scaleRatio
  if (realMm >= 1000) return `${(realMm / 1000).toFixed(2)} m`
  return `${realMm.toFixed(0)} mm`
}

export const newShapeId = (type: string) =>
  `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
