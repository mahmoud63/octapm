import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from './Text'
import { useTheme } from './theme'
import { radius, spacing } from './tokens'

export interface KPIProps {
  label: string
  value: string
  /** A word beside the figure: "overdue", "due today". */
  qualifier?: string
  tone?: 'default' | 'success' | 'warning' | 'error'
  onPress?: () => void
}

/** A figure with its name, and a way through to the records behind it. */
export function KPI({ label, value, qualifier, tone = 'default', onPress }: KPIProps) {
  const theme = useTheme()
  const color = { default: theme.colors.brand, success: theme.colors.success, warning: theme.colors.warning, error: theme.colors.error }[tone]
  const body = (
    <View style={[styles.kpi, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <Text variant="label" label tone="muted">
        {label}
      </Text>
      <View style={styles.valueRow}>
        <Text variant="kpi" style={[{ color }, styles.value]}>
          {value}
        </Text>
        {qualifier ? (
          <Text variant="caption" tone="muted">
            {qualifier}
          </Text>
        ) : null}
      </View>
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}${qualifier ? ` ${qualifier}` : ''}`} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, flex: 1 })}>
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  kpi: { flex: 1, minWidth: 140, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  value: { fontVariant: ['tabular-nums'] },
})
