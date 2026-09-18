import { StyleSheet, View, type ViewStyle } from 'react-native'
import { Button } from './Button'
import { Text } from './Text'
import { useTheme } from './theme'
import { radius, spacing } from './tokens'

/** Nothing here, and that is fine. Say what would fill it. */
export function EmptyState({ title, body, action, style }: { title: string; body?: string; action?: { title: string; onPress: () => void }; style?: ViewStyle }) {
  return (
    <View style={[styles.center, style]} accessibilityRole="summary">
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body ? (
        <Text tone="muted" align="center" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {action ? <Button variant="secondary" title={action.title} onPress={action.onPress} style={styles.action} /> : null}
    </View>
  )
}

/** Something failed. What, what to do, and a way to try again. */
export function ErrorState({ message, onRetry, style }: { message: string; onRetry?: () => void; style?: ViewStyle }) {
  const theme = useTheme()
  return (
    <View style={[styles.center, style]} accessibilityRole="alert">
      <View style={[styles.errorMark, { backgroundColor: theme.colors.errorSoft }]}>
        <Text variant="heading" tone="error">
          !
        </Text>
      </View>
      <Text variant="heading" align="center">
        Something did not work
      </Text>
      <Text tone="muted" align="center" style={styles.body}>
        {message}
      </Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} style={styles.action} /> : null}
    </View>
  )
}

/** A placeholder the shape of what is coming, so the page does not jump. */
export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: ViewStyle }) {
  const theme = useTheme()
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ height, width, borderRadius: radius.sm, backgroundColor: theme.colors.skeleton }, style]} />
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <View style={styles.skeletonList} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton width="38%" height={12} />
          <Skeleton height={18} />
          <Skeleton width="62%" height={12} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  body: { maxWidth: 360 },
  action: { marginTop: spacing.sm },
  errorMark: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  skeletonList: { gap: spacing.lg, padding: spacing.lg },
  skeletonRow: { gap: spacing.sm },
})
