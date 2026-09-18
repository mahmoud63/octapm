import { StyleSheet, View } from 'react-native'
import { Badge, Text, spacing, toneForStatus } from '@/design-system'
import { humanise } from '@/utilities/format'

/**
 * The top of every record: reference, title, status, and the one or two
 * facts a person checks first. The same shape on every record type, so the
 * eye lands in the same place.
 */
export function RecordHeader({ reference, title, status, priority, meta, testID }: { reference: string; title: string; status?: string | null; priority?: string | null; meta?: string[]; testID?: string }) {
  const urgent = priority === 'high' || priority === 'urgent' || priority === 'critical'
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.row}>
        <Text variant="label" label tone="brand">
          {reference}
        </Text>
        {status ? <Badge label={humanise(status)} tone={toneForStatus(status)} /> : null}
        {priority ? <Badge label={humanise(priority)} tone={urgent ? 'error' : 'neutral'} /> : null}
      </View>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {meta && meta.filter(Boolean).length ? (
        <Text variant="caption" tone="muted">
          {meta.filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
})
