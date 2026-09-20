import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useDailyLogDays } from '@/api/site-hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shiftDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return isoDay(new Date(y!, m! - 1, d! + days, 12))
}

const RANGES = [
  { id: 14, label: 'Last 2 weeks' },
  { id: 30, label: 'Last month' },
  { id: 90, label: 'Last 3 months' },
] as const

/**
 * The days behind today.
 *
 * A site engineer looks back for one of two reasons: to finish a day they left
 * open, or to find what was recorded when someone asks. So the status leads —
 * an open day is the one that still wants them — and the figures that follow
 * are the ones an argument is usually about: who was on site and how long was
 * lost.
 */
export default function PreviousReportsScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const [span, setSpan] = useState<number>(14)

  const today = isoDay(new Date())
  const from = shiftDays(today, -span)
  const days = useDailyLogDays(projectId, from, today)

  // Newest first: the day a person wants is almost always the most recent one.
  const rows = useMemo(() => [...(days.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [days.data])

  if (!projectId) {
    return (
      <Screen title="Previous reports" testID="screen-site-previous">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="Daily reports belong to one project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen title="Previous reports" subtitle={project?.name} contentStyle={styles.content} testID="screen-site-previous">
      <ProjectSwitch project={project} />

      <View style={styles.spans}>
        {RANGES.map((range) => (
          <Text
            key={range.id}
            onPress={() => setSpan(range.id)}
            tone={span === range.id ? 'default' : 'muted'}
            accessibilityRole="button"
            accessibilityState={{ selected: span === range.id }}
            testID={`site-span-${range.id}`}
          >
            {range.label}
          </Text>
        ))}
      </View>

      {days.isPending ? (
        <SkeletonList rows={5} />
      ) : days.isError ? (
        <ErrorState message={userMessage(days.error)} onRetry={() => void days.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No reports yet" body="A day appears here once something has been recorded on it." />
      ) : (
        rows.map((row) => {
          const totals = row.totals ?? {}
          const meta = [
            totals.workers != null ? `${totals.workers} on site` : null,
            totals.entries != null ? `${totals.entries} entr${totals.entries === 1 ? 'y' : 'ies'}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <RecordRow
              key={row.date}
              reference={day(`${row.date}T12:00:00`)}
              title={row.status === 'open' ? 'Still open' : humanise(row.status)}
              status={row.status}
              meta={meta || 'Nothing recorded'}
              trailing={totals.hoursLost ? `${totals.hoursLost} h lost` : undefined}
              trailingTone={totals.hoursLost ? 'warning' : 'muted'}
              onPress={() => router.push(`/site?date=${row.date}`)}
              testID={`site-day-${row.date}`}
            />
          )
        })
      )}
      <Freshness updatedAt={days.dataUpdatedAt || undefined} isFetching={days.isFetching} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  spans: { flexDirection: 'row', gap: spacing.md },
})
