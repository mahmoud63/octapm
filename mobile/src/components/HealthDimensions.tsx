import { StyleSheet, View } from 'react-native'
import type { HealthDimension } from '@/api/types'
import { Text, radius, spacing, useTheme } from '@/design-system'

/** The score's colour band, the same thresholds the web dashboard uses. */
export function healthTone(score: number | null | undefined): 'success' | 'warning' | 'error' | 'muted' {
  if (score == null) return 'muted'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'error'
}

/**
 * The seven health dimensions as a wrapping row of chips. Scores are read as
 * a colour first and a number second; a missing score says so instead of
 * pretending.
 */
export function HealthDimensions({ dimensions }: { dimensions: HealthDimension[] }) {
  const theme = useTheme()
  const palette = {
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
    warning: { bg: theme.colors.warningSoft, fg: theme.colors.warning },
    error: { bg: theme.colors.errorSoft, fg: theme.colors.error },
    muted: { bg: theme.colors.skeleton, fg: theme.colors.textMuted },
  }
  return (
    <View style={styles.wrap} accessibilityRole="list">
      {dimensions.map((dimension) => {
        const tone = palette[healthTone(dimension.score)]
        return (
          <View key={dimension.key} style={[styles.chip, { backgroundColor: tone.bg }]} accessibilityLabel={`${dimension.label} ${dimension.score ?? 'no score'}`} testID={`health-${dimension.key}`}>
            <Text variant="caption" style={{ color: tone.fg }}>
              {dimension.label}
            </Text>
            <Text variant="heading" style={{ color: tone.fg, fontVariant: ['tabular-nums'] }}>
              {dimension.score ?? '—'}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minWidth: 96, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, gap: 2 },
})
