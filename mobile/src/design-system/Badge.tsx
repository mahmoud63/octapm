import { StyleSheet, View } from 'react-native'
import { Text } from './Text'
import { useTheme } from './theme'
import { radius, spacing } from './tokens'

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'brand'

/**
 * A status, as a word with a colour behind it. The word is the meaning; the
 * colour is a hint. Never the other way around.
 */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const theme = useTheme()
  const colors = {
    neutral: { bg: theme.colors.skeleton, fg: theme.colors.textMuted },
    info: { bg: theme.colors.infoSoft, fg: theme.colors.info },
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
    warning: { bg: theme.colors.warningSoft, fg: theme.colors.warning },
    error: { bg: theme.colors.errorSoft, fg: theme.colors.error },
    brand: { bg: theme.colors.infoSoft, fg: theme.colors.brand },
  }[tone]
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]} accessibilityLabel={`Status: ${label}`}>
      <Text variant="label" label style={{ color: colors.fg }}>
        {label}
      </Text>
    </View>
  )
}

/** The tone a record status should carry. Unknown statuses stay neutral. */
export function toneForStatus(status: string | null | undefined): BadgeTone {
  const s = (status ?? '').toLowerCase()
  if (/closed|complete|approved|certified|paid|received|resolved|passed/.test(s)) return 'success'
  if (/overdue|rejected|failed|void|blocked|disputed|cancel/.test(s)) return 'error'
  if (/pending|awaiting|submitted|review|in_progress|in progress|answered/.test(s)) return 'warning'
  if (/open|draft|new|issued|active/.test(s)) return 'info'
  return 'neutral'
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs + 1, borderRadius: radius.full },
})
