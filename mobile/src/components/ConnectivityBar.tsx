import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text, spacing, useTheme } from '@/design-system'
import { tapTarget } from '@/design-system/tokens'
import { useOutboxStatus } from '@/offline/useOutboxStatus'

/**
 * One honest line across the top of the shell, shown only when there is
 * something to say: the device is offline, items are waiting to send, or
 * an item needs the person. Tapping it opens the outbox.
 */
export function ConnectivityBar() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const status = useOutboxStatus()

  let label: string | null = null
  let tone = theme.colors.warning
  if (status.attention > 0) {
    label = `${status.attention} item${status.attention === 1 ? '' : 's'} need${status.attention === 1 ? 's' : ''} your attention`
    tone = theme.colors.error
  } else if (status.offline) {
    label = status.waiting > 0 ? `Offline · ${status.waiting} item${status.waiting === 1 ? '' : 's'} waiting to send` : 'Offline · showing what was saved on this device'
  } else if (status.locked && status.waiting > 0) {
    label = `${status.waiting} item${status.waiting === 1 ? '' : 's'} waiting for you to sign in again`
  } else if (status.draining) {
    label = `Sending ${status.waiting} item${status.waiting === 1 ? '' : 's'}…`
    tone = theme.colors.brand
  } else if (status.waiting > 0) {
    label = `${status.waiting} item${status.waiting === 1 ? '' : 's'} waiting to send`
  }
  if (!label) return null

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Open the outbox`} onPress={() => router.push('/outbox')} style={[styles.bar, { backgroundColor: tone, paddingTop: insets.top + spacing.xs }]} testID="connectivity-bar">
      <View style={styles.row}>
        <Text variant="caption" style={{ color: theme.colors.textOnBrand }}>
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, minHeight: tapTarget, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
})
