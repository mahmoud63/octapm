import { useRef, useState } from 'react'
import { Modal, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg from 'react-native-svg'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'
import { StrokeLayer, paintStrokes, useStrokeCapture, type Stroke } from '@/components/strokes'

export { strokePoints, type Stroke } from '@/components/strokes'

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
  paintStrokes(ctx, strokes, '#111827', 2.5)
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
  const { strokes, current, clear, panHandlers } = useStrokeCapture()
  const [name, setName] = useState(defaultName ?? '')
  const [size, setSize] = useState({ width: 600, height: 240 })
  const [failure, setFailure] = useState<string | null>(null)
  const padRef = useRef<View>(null)

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
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
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
        <View ref={padRef} collapsable={false} onLayout={onLayout} style={[styles.pad, { borderColor: theme.colors.border, backgroundColor: '#ffffff' }]} testID={`${testID}-pad`} accessibilityLabel="Signature area" accessibilityHint="Draw your signature here" {...panHandlers}>
          <Svg width="100%" height="100%" pointerEvents="none">
            <StrokeLayer strokes={strokes} current={current} />
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
