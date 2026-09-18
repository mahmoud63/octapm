import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { Activity } from '@/api/site-types'
import { Text, spacing, useTheme } from '@/design-system'
import { day } from '@/utilities/format'

const DAY_MS = 86_400_000

/** Where a window of dates puts each activity, as fractions of the width; for the strip and for tests. */
export function timelineScale(activities: Pick<Activity, 'startDate' | 'endDate'>[], today = new Date()) {
  const dates = activities.flatMap((a) => [a.startDate, a.endDate]).filter((d): d is string => !!d).map((d) => new Date(d).getTime())
  if (!dates.length) return null
  const start = Math.min(...dates, today.getTime())
  const end = Math.max(...dates, today.getTime())
  const span = Math.max(DAY_MS, end - start)
  const at = (iso: string | null | undefined) => (iso ? Math.min(1, Math.max(0, (new Date(iso).getTime() - start) / span)) : null)
  return { start, end, span, at, todayAt: (today.getTime() - start) / span }
}

/**
 * A read-only timeline for the wide screen: one row per activity, a bar
 * from start to finish coloured by state, the critical ones marked, and a
 * line for today. Enough to see the shape of the programme on site; the
 * Gantt proper stays on the web.
 */
export function TimelineStrip({ activities, onOpen, testID = 'timeline' }: { activities: Activity[]; onOpen?: (id: string) => void; testID?: string }) {
  const theme = useTheme()
  const scale = timelineScale(activities)
  if (!scale) {
    return (
      <Text tone="muted" testID={testID}>
        No dated activities to draw.
      </Text>
    )
  }
  const colour = (a: Activity) => (a.status === 'complete' ? theme.colors.success : a.status === 'delayed' ? theme.colors.error : a.status === 'in_progress' ? theme.colors.brand : theme.colors.textMuted)
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.axis}>
        <Text variant="caption" tone="muted">
          {day(new Date(scale.start))}
        </Text>
        <Text variant="caption" tone="muted">
          Today
        </Text>
        <Text variant="caption" tone="muted">
          {day(new Date(scale.end))}
        </Text>
      </View>
      <ScrollView style={styles.rows} nestedScrollEnabled>
        {activities.map((a) => {
          const from = scale.at(a.startDate) ?? 0
          const to = scale.at(a.endDate) ?? from
          const width = Math.max(0.006, to - from)
          return (
            <Pressable key={a.id} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={`${a.name}, ${a.startDate ? day(a.startDate) : 'no start'} to ${a.endDate ? day(a.endDate) : 'no finish'}`} onPress={onOpen ? () => onOpen(a.id) : undefined} style={[styles.row, { borderColor: theme.colors.border }]} testID={`${testID}-row-${a.id}`}>
              <Text variant="caption" numberOfLines={1} style={styles.name}>
                {a.isCritical ? '● ' : ''}
                {a.name}
              </Text>
              <View style={styles.track}>
                <View style={[styles.today, { left: `${scale.todayAt * 100}%`, backgroundColor: theme.colors.warning }]} />
                <View style={[styles.bar, { left: `${from * 100}%`, width: `${width * 100}%`, backgroundColor: colour(a), borderColor: a.isCritical ? theme.colors.error : 'transparent' }]}>
                  {a.pctComplete != null && a.pctComplete > 0 ? <View style={[styles.done, { width: `${Math.min(100, a.pctComplete)}%` }]} /> : null}
                </View>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>
      <Text variant="caption" tone="muted">
        ● critical · bars coloured by state · the lighter part of a bar is the approved progress
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  axis: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 180 },
  rows: { maxHeight: 520 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { width: 172 },
  track: { flex: 1, height: 14, position: 'relative' },
  today: { position: 'absolute', top: -4, bottom: -4, width: 2, opacity: 0.8 },
  bar: { position: 'absolute', top: 0, bottom: 0, borderRadius: 4, borderWidth: 1, overflow: 'hidden' },
  done: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,255,255,0.45)' },
})
