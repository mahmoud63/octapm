import { useMemo, useRef, useState } from 'react'
import { PanResponder, type GestureResponderHandlers } from 'react-native'
import { Polyline } from 'react-native-svg'

export type Point = { x: number; y: number }
export type Stroke = Point[]

/** The strokes as one SVG points list each, for drawing and for tests. */
export const strokePoints = (stroke: Stroke) => stroke.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

/**
 * Freehand strokes captured through the platform's responder system, so a
 * finger, a stylus and a mouse all draw. Coordinates are relative to the
 * view the handlers are spread onto. Shared by the signature pad and the
 * photo markup sheet.
 */
export function useStrokeCapture() {
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [current, setCurrent] = useState<Stroke>([])
  const live = useRef<Stroke>([])

  const finish = () => {
    const done = live.current
    live.current = []
    if (done.length) setStrokes((all) => [...all, done])
    setCurrent([])
  }

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          live.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }]
          setCurrent(live.current)
        },
        onPanResponderMove: (e) => {
          live.current = [...live.current, { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }]
          setCurrent(live.current)
        },
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
      }),
    [],
  )

  const clear = () => {
    live.current = []
    setStrokes([])
    setCurrent([])
  }
  const undo = () => setStrokes((all) => all.slice(0, -1))

  return { strokes, current, clear, undo, panHandlers: responder.panHandlers as GestureResponderHandlers }
}

/** The strokes drawn as SVG polylines; goes inside an `Svg` that covers the capture view. */
export function StrokeLayer({ strokes, current, color = '#111827', width = 2.5 }: { strokes: Stroke[]; current: Stroke; color?: string; width?: number }) {
  return (
    <>
      {strokes.map((s, i) => (
        <Polyline key={i} points={strokePoints(s)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {current.length ? <Polyline points={strokePoints(current)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </>
  )
}

/** Draw strokes onto a 2D canvas context (web only). */
export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], color: string, width: number, scale = 1) {
  ctx.strokeStyle = color
  ctx.lineWidth = width * scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (stroke.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(stroke[0]!.x * scale, stroke[0]!.y * scale)
    for (const p of stroke.slice(1)) ctx.lineTo(p.x * scale, p.y * scale)
    if (stroke.length === 1) ctx.lineTo(stroke[0]!.x * scale + 0.5, stroke[0]!.y * scale + 0.5)
    ctx.stroke()
  }
}
