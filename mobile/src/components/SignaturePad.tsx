import { useMemo, useRef, useState } from 'react'
import { Modal, PanResponder, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Polyline } from 'react-native-svg'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'

export type Stroke = { x: number; y: number }[]

/** The strokes as one SVG points list each, for drawing and for tests. */
export const strokePoints = (stroke: Stroke) => stroke.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

/**
 * Draw the strokes onto a canvas and return a PNG data URL, the form the
 * server accepts. On the web target the browser's canvas does it; on a
 * device the pad's own view is captured.
 */
export async function rasterise(strokes: Stroke[], size: { width: number; height: number }, capture?: () => Promise<string>): Promise<string> {
  if (Platform.OS !== 'web') {
    if (!capture) throw new Error('No capture available on this platform')
    return capture()
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(size.width))
  canvas.height = Math.max(1, Math.round(size.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The signature could not be drawn')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#111827'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (stroke.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(stroke[0]!.x, stroke[0]!.y)
    for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y)
    if (stroke.length === 1) ctx.lineTo(stroke[0]!.x + 0.5, stroke[0]!.y + 0.5)
    ctx.stroke()
  }
  return canvas.toDataURL('image/png')
}

/**
 * A signature pad: a finger, a stylus or a mouse draws through the
 * platform's responder system, the strokes are rendered as they land, and
 * the result is sent as a PNG data URL with the signer's name. Nothing is
 * saved until the person confirms.
 */
export function SignaturePad({ visible, title, roleLabel, defaultName, busy, error, onCancel, onConfirm, testID = 'signature' }: { visible: boolean; title: string; roleLabel: string; defaultName?: string; busy?: boolean; error?: string | null; onCancel: () => void; onConfirm: (result: { image: string; signerName: string }) => void; testID?: string }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [current, setCurrent] = useState<Stroke>([])
  const [name, setName] = useState(defaultName ?? '')
  const [size, setSize] = useState({ width: 600, height: 240 })
  const [failure, setFailure] = useState<string | null>(null)
  const padRef = useRef<View>(null)
  const live = useRef<Stroke>([])

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
        onPanResponderRelease: () => {
          const done = live.current
          live.current = []
          if (done.length) setStrokes((all) => [...all, done])
          setCurrent([])
        },
        onPanResponderTerminate: () => {
          const done = live.current
          live.current = []
          if (done.length) setStrokes((all) => [...all, done])
          setCurrent([])
        },
      }),
    [],
  )

  const clear = () => {
    live.current = []
    setStrokes([])
    setCurrent([])
  }

  const confirm = async () => {
    setFailure(null)
    try {
      const capture = async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { captureRef } = require('react-native-view-shot') as { captureRef: (ref: unknown, o: { format: 'png'; result: 'data-uri'; quality: number }) => Promise<string> }
        return captureRef(padRef, { format: 'png', result: 'data-uri', quality: 1 })
      }
      const image = await rasterise(strokes, size, capture)
      onConfirm({ image, signerName: name.trim() })
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The signature could not be prepared')
    }
  }

  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
  const ready = strokes.length > 0 && name.trim().length > 0

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="pageSheet">
      <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]} testID={testID}>
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text variant="title">{title}</Text>
            <Text variant="caption" tone="muted">
              Signing as {roleLabel}
            </Text>
          </View>
          <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} testID={`${testID}-cancel`} />
        </View>
        <Input label="Name" required value={name} onChangeText={setName} placeholder="Who is signing" testID={`${testID}-name`} />
        <Text variant="caption" tone="muted">
          Sign in the box with a finger, a stylus or the mouse.
        </Text>
        <View ref={padRef} collapsable={false} onLayout={onLayout} style={[styles.pad, { borderColor: theme.colors.border, backgroundColor: '#ffffff' }]} testID={`${testID}-pad`} {...responder.panHandlers}>
          <Svg width="100%" height="100%" pointerEvents="none">
            {strokes.map((s, i) => (
              <Polyline key={i} points={strokePoints(s)} fill="none" stroke="#111827" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {current.length ? <Polyline points={strokePoints(current)} fill="none" stroke="#111827" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
          </Svg>
        </View>
        {failure || error ? (
          <Text variant="caption" tone="error" accessibilityRole="alert">
            {failure ?? error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button title="Clear" variant="secondary" onPress={clear} disabled={busy || strokes.length === 0} testID={`${testID}-clear`} />
          <Button title="Sign" size="lg" disabled={!ready} loading={busy} onPress={() => void confirm()} testID={`${testID}-confirm`} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  pad: { height: 240, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
})
