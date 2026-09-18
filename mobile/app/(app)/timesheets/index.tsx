import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useTimesheets } from '@/api/site-hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, KPI, RecordRow, SkeletonList, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The last two weeks of timesheets for the crews this person may see. */
export default function TimesheetsScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const range = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - 13 * 86_400_000)
    return { from: isoDay(from), to: isoDay(to) }
  }, [])
  const timesheets = useTimesheets(projectId, range)
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const rows = timesheets.data?.items ?? []

  if (!projectId) {
    return (
      <Screen testID="screen-timesheets">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-timesheets">
      <FlatList
        data={rows}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <ProjectSwitch project={project} />
            {permissions.allows('timesheet', 'create') ? <Button title="New timesheet" onPress={() => router.push('/timesheets/new')} testID="timesheet-new" /> : null}
            <View style={styles.kpis}>
              <KPI label="Sheets" value={String(timesheets.data?.summary.count ?? '—')} />
              <KPI label="Regular h" value={String(timesheets.data?.summary.regularHours ?? '—')} />
              <KPI label="Overtime h" value={String(timesheets.data?.summary.overtimeHours ?? '—')} />
            </View>
            <Freshness updatedAt={timesheets.dataUpdatedAt || undefined} isFetching={timesheets.isFetching} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={day(`${item.date}T12:00:00`)}
            title={item.crew?.name ?? (item.crewId ? 'Crew' : 'Individual entries')}
            status={item.status}
            meta={[`${item.entries?.length ?? 0} entr${(item.entries?.length ?? 0) === 1 ? 'y' : 'ies'}`, item.totals?.regularHours != null ? `${item.totals.regularHours} h` : null].filter(Boolean).join(' · ')}
            onPress={() => router.push(`/timesheets/${item.id}`)}
            testID={`timesheet-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          timesheets.isPending ? (
            <SkeletonList rows={4} />
          ) : timesheets.isError ? (
            <ErrorState message={userMessage(timesheets.error)} onRetry={() => void timesheets.refetch()} />
          ) : (
            <EmptyState title="No timesheets in the last two weeks" body={permissions.allows('timesheet', 'create') ? 'Start one for a crew from the button above.' : undefined} />
          )
        }
        onRefresh={() => void timesheets.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})

export { humanise }
