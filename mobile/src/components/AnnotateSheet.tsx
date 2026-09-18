import { useEffect, useRef, useState } from 'react'
import { Image, Modal, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg from 'react-native-svg'
import { Button, Text, spacing, useTheme } from '@/design-system'
import { StrokeLayer, useStrokeCapture } from '@/components/strokes'
import { composeMarkedPhoto, type MarkedPhoto } from '@/photos/annotate'

export interface PhotoFile {
  uri: string
  name: string
  type: string
}

// The field is "hex", not "value": reanimated's babel plugin treats any `.value` inside a style object as a shared value and injects its runtime.
const COLOURS: { id: string; label: string; hex: string }[] = [
  { id: 'red', label: 'Red', hex: '#ef4444' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'black', label: 'Black', hex: '#111827' },
]
const STROKE_WIDTH = 4

/**
 * Mark up a photo before it is uploaded: circle the defect, arrow the
 * spot, cross out what is wrong. The strokes are drawn over the photo as
 * shown and burnt into a copy at the photo's own size; the original stays
 * untouched until the person confirms, and the marked copy replaces it in
 * the upload. Built on the pad's stroke capture, so it draws with a finger,
 * a stylus or the mouse.
 */
export function AnnotateSheet({ visible, photo, onCancel, onConfirm, testID = 'annotate' }: { visible: boolean; photo: PhotoFile | null; onCancel: () => void; onConfirm: (marked: MarkedPhoto) => void; testID?: string }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { strokes, current, clear, undo, panHandlers } = useStrokeCapture()
  const [colour, setColour] = useState(COLOURS[0]!)
  const [view, setView] = useState({ width: 0, height: 0 })
  const [image, setImage] = useState({ width: 0, height: 0 })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const canvasRef = useRef<View>(null)

  useEffect(() => {
    clear()
    setFailure(null)
    if (!photo) return
    Image.getSize(
      photo.uri,
      (width, height) => setImage({ width, height }),
      () => setImage({ width: 0, height: 0 }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.uri])

  const confirm = async () => {
    if (!photo) return
    setBusy(true)
    setFailure(null)
    try {
      const capture = async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { captureRef } = require('react-native-view-shot') as { captureRef: (ref: unknown, o: { format: 'jpg'; result: 'tmpfile'; quality: number }) => Promise<string> }
        return captureRef(canvasRef, { format: 'jpg', result: 'tmpfile', quality: 0.9 })
      }
      const marked = await composeMarkedPhoto({ uri: photo.uri, name: photo.name, strokes, color: colour.hex, width: STROKE_WIDTH, view, image, capture })
      onConfirm(marked)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The photo could not be marked')
    } finally {
      setBusy(false)
    }
  }

  const onLayout = (e: LayoutChangeEvent) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]} testID={testID}>
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text variant="title" accessibilityRole="header">
              Mark up photo
            </Text>
            <Text variant="caption" tone="muted">
              Draw on the photo with a finger, a stylus or the mouse. The marked copy is what gets uploaded.
            </Text>
          </View>
          <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} testID={`${testID}-cancel`} />
        </View>
        <View style={styles.colours} accessibilityRole="radiogroup" accessibilityLabel="Pen colour">
          {COLOURS.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setColour(c)}
              accessibilityRole="radio"
              accessibilityLabel={`${c.label} pen`}
              accessibilityState={{ selected: colour.id === c.id, checked: colour.id === c.id }}
              style={[styles.swatch, { backgroundColor: c.hex, borderColor: colour.id === c.id ? theme.colors.brand : theme.colors.border, borderWidth: colour.id === c.id ? 3 : 1 }]}
              testID={`${testID}-colour-${c.id}`}
              hitSlop={8}
            />
          ))}
        </View>
        <View ref={canvasRef} collapsable={false} onLayout={onLayout} style={[styles.canvas, { borderColor: theme.colors.border }]} testID={`${testID}-canvas`} accessibilityLabel="Photo markup area" {...panHandlers}>
          {photo ? <Image source={{ uri: photo.uri }} resizeMode="contain" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
          <Svg width="100%" height="100%" pointerEvents="none" style={StyleSheet.absoluteFill}>
            <StrokeLayer strokes={strokes} current={current} color={colour.hex} width={STROKE_WIDTH} />
          </Svg>
        </View>
        {failure ? (
          <Text variant="caption" tone="error" accessibilityRole="alert">
            {failure}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <View style={styles.row}>
            <Button title="Undo" variant="secondary" onPress={undo} disabled={busy || strokes.length === 0} testID={`${testID}-undo`} />
            <Button title="Clear" variant="secondary" onPress={clear} disabled={busy || strokes.length === 0} testID={`${testID}-clear`} />
          </View>
          <Button title="Use marked photo" size="lg" disabled={strokes.length === 0 || (Platform.OS === 'web' && image.width === 0)} loading={busy} onPress={() => void confirm()} testID={`${testID}-confirm`} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  colours: { flexDirection: 'row', gap: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  canvas: { flex: 1, borderWidth: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000000' },
  actions: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
})
