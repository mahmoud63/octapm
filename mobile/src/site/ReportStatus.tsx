import { StyleSheet, View } from 'react-native'
import { Badge, Button, Card, Text, spacing, toneForStatus, useTheme } from '@/design-system'
import { day, humanise } from '@/utilities/format'

export interface ReportLine {
  id: string
  label: string
  value: string
  tone?: 'default' | 'muted' | 'error' | 'warning'
}

/**
 * What the day amounts to so far, and whether it has been sent.
 *
 * A daily report is written in pieces across a working day and finished in a
 * hurry at the end of it, usually by someone standing up. So the first thing
 * on the screen is the tally — enough to see at a glance what is already down
 * and what is obviously missing — and then the one button that continues it.
 * The figures are the server's own totals; nothing here is counted twice.
 */
export function ReportStatus({
  date,
  status,
  lines,
  preparedBy,
  updatedAt,
  action,
  testID = 'site-status',
}: {
  date: string
  status: string
  lines: ReportLine[]
  preparedBy?: string | null
  updatedAt?: string | null
  action?: { title: string; onPress: () => void; testID?: string } | null
  testID?: string
}) {
  const theme = useTheme()
  const open = status === 'open'

  return (
    <Card testID={testID}>
      <View style={styles.stack}>
        <View style={styles.head}>
          <View style={styles.grow}>
            <Text variant="label" label tone="muted">
              Daily report
            </Text>
            <Text variant="heading" testID={`${testID}-date`}>
              {day(`${date}T12:00:00`)}
            </Text>
          </View>
          <Badge label={open ? 'In progress' : humanise(status)} tone={open ? 'warning' : toneForStatus(status)} />
        </View>

        <View style={[styles.lines, { borderColor: theme.colors.border }]}>
          {lines.map((line) => (
            // A tally, not a menu: a row of eight controls would either miss the
            // forty-pixel tap target or make the card taller than the day it
            // summarises. The sections below are where a person goes next.
            <View key={line.id} style={styles.line} testID={`${testID}-${line.id}`}>
              <Text tone="muted" style={styles.grow}>
                {line.label}
              </Text>
              <Text tone={line.tone === 'default' ? undefined : line.tone}>{line.value}</Text>
            </View>
          ))}
        </View>

        {preparedBy || updatedAt ? (
          <Text variant="caption" tone="muted" testID={`${testID}-provenance`}>
            {[preparedBy ? `Prepared by ${preparedBy}` : null, updatedAt ? `updated ${day(updatedAt)}` : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}

        {action ? <Button title={action.title} size="lg" fullWidth onPress={action.onPress} testID={action.testID ?? `${testID}-continue`} /> : null}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  lines: { borderTopWidth: 1, paddingTop: spacing.sm, gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
