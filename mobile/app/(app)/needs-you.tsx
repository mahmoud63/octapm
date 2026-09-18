import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useAssignments, useProjects } from '@/api/hooks'
import type { AssignmentItem } from '@/api/types'
import { AssignmentRow } from '@/components/AssignmentRow'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, KPI, SkeletonList, Text, spacing } from '@/design-system'
import { destinationForTarget, openOnWeb } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { listPerformance } from '@/components/listProps'

type Mode = 'all' | 'ballInCourt' | 'overdue'

/**
 * Everything on this project that is waiting for the person: assigned to
 * them, or with the ball in their court. Sorted by the server: ball in court,
 * then overdue, then by due date.
 */
export default function NeedsYouScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const assignments = useAssignments(projectId)
  const [mode, setMode] = useState<Mode>('all')
  const [type, setType] = useState<string | null>(null)

  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const items = useMemo(() => assignments.data?.items ?? [], [assignments.data])
  const labels = useMemo(() => new Map(items.map((item) => [item.recordType, item.label])), [items])
  const rows = useMemo(
    () => items.filter((item) => (mode === 'ballInCourt' ? item.ballInCourt : mode === 'overdue' ? item.overdue : true)).filter((item) => (type ? item.recordType === type : true)),
    [items, mode, type]
  )
  const open = (item: AssignmentItem) => {
    const destination = destinationForTarget(item.target)
    if ('app' in destination) router.push(destination.app as never)
    else void openOnWeb(destination.web)
  }

  if (!projectId) {
    return (
      <Screen title="Needs You" testID="screen-needs-you">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="Needs You shows what is waiting for you on one project at a time." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const summary = assignments.data?.summary

  return (
    <Screen title="Needs You" subtitle={summary ? `${summary.total} open item${summary.total === 1 ? '' : 's'}` : undefined} scroll={false} testID="screen-needs-you">
      <FlatList {...listPerformance}
        data={rows}
        keyExtractor={(item) => `${item.recordType}:${item.recordId}`}
        ListHeaderComponent={
          <View style={styles.header}>
            <ProjectSwitch project={project} />
            <View style={styles.kpis}>
              <KPI label="Ball in court" value={String(summary?.ballInCourt ?? '—')} onPress={() => setMode('ballInCourt')} />
              <KPI label="Overdue" value={String(summary?.overdue ?? '—')} tone={(summary?.overdue ?? 0) > 0 ? 'error' : 'default'} onPress={() => setMode('overdue')} />
              <KPI label="All" value={String(summary?.total ?? '—')} onPress={() => setMode('all')} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={mode === 'all'} onPress={() => setMode('all')} testID="chip-all" />
              <FilterChip label="Ball in court" selected={mode === 'ballInCourt'} onPress={() => setMode('ballInCourt')} testID="chip-ball" />
              <FilterChip label="Overdue" selected={mode === 'overdue'} onPress={() => setMode('overdue')} testID="chip-overdue" />
              {Object.entries(summary?.byType ?? {}).map(([key, count]) => (
                <FilterChip key={key} label={labels.get(key) ?? key} count={count} selected={type === key} onPress={() => setType(type === key ? null : key)} testID={`chip-type-${key}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={assignments.dataUpdatedAt || undefined} isFetching={assignments.isFetching} />
            {rows.length > 0 ? (
              <Text variant="caption" tone="muted">
                RFIs and tasks open in the app; other records open on the web until their screens arrive.
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <AssignmentRow item={item} onPress={() => open(item)} />}
        ListEmptyComponent={
          assignments.isPending ? (
            <SkeletonList rows={4} />
          ) : assignments.isError ? (
            <ErrorState message={userMessage(assignments.error)} onRetry={() => void assignments.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title="Nothing is waiting on you" body="When a record needs your answer, approval or action on this project, it appears here." />
          ) : (
            <EmptyState title="Nothing matches these filters" action={{ title: 'Clear filters', onPress: () => { setMode('all'); setType(null) } }} />
          )
        }
        onRefresh={() => void assignments.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
