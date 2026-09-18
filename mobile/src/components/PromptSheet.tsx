import { useEffect, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'

interface Props {
  visible: boolean
  title: string
  body?: string
  label: string
  placeholder?: string
  required?: boolean
  confirmTitle: string
  destructive?: boolean
  busy?: boolean
  error?: string | null
  /** An optional switch shown under the text, for example "Official answer". */
  toggle?: { label: string; value: boolean; onChange: (value: boolean) => void }
  onCancel: () => void
  onConfirm: (text: string) => void
  testID?: string
}

/**
 * Asks for the one thing a transition needs: a reason, a comment, an
 * answer. The text is required when the server requires it, and the confirm
 * button says exactly what will happen.
 */
export function PromptSheet({ visible, title, body, label, placeholder, required, confirmTitle, destructive, busy, error, toggle, onCancel, onConfirm, testID = 'prompt' }: Props) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  useEffect(() => {
    if (visible) setText('')
  }, [visible])
  const ready = !required || text.trim().length > 0

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingBottom: insets.bottom + spacing.lg }]} testID={testID}>
          <Text variant="title">{title}</Text>
          {body ? <Text tone="muted">{body}</Text> : null}
          <Input label={label} placeholder={placeholder} required={required} value={text} onChangeText={setText} multiline autoFocus testID={`${testID}-input`} />
          {toggle ? <Button title={`${toggle.value ? '☑' : '☐'}  ${toggle.label}`} variant="ghost" onPress={() => toggle.onChange(!toggle.value)} testID={`${testID}-toggle`} /> : null}
          {error ? (
            <Text variant="caption" tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} testID={`${testID}-cancel`} />
            <Button title={confirmTitle} variant={destructive ? 'danger' : 'primary'} disabled={!ready} loading={busy} onPress={() => onConfirm(text.trim())} testID={`${testID}-confirm`} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { padding: spacing.lg, gap: spacing.md, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
})
