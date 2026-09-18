import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { network } from '@/api/network'
import { Text, spacing, useTheme } from '@/design-system'
import { relative } from '@/utilities/format'

/**
 * One honest line about the data on screen: live, cached and how old, or
 * offline. Every screen that shows server records carries one.
 */
export function Freshness({ updatedAt, isFetching }: { updatedAt?: number; isFetching?: boolean }) {
  const theme = useTheme()
  const [offline, setOffline] = useState(network.isKnownOffline())

  useEffect(() => network.subscribe(() => setOffline(network.isKnownOffline())), [])

  let label: string
  let color = theme.colors.textMuted
  if (offline) {
    label = updatedAt ? `Offline · showing data from ${relative(new Date(updatedAt))}` : 'Offline'
    color = theme.colors.warning
  } else if (isFetching) {
    label = 'Updating…'
  } else if (updatedAt) {
    label = Date.now() - updatedAt < 90_000 ? 'Live' : `Updated ${relative(new Date(updatedAt))}`
  } else {
    label = 'Waiting for the server'
  }

  return (
    <View style={styles.row} accessibilityLiveRegion="polite" testID="freshness">
      <View style={[styles.dot, { backgroundColor: offline ? theme.colors.warning : theme.colors.success }]} />
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
