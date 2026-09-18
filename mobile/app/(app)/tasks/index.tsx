import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useTasks } from '@/api/record-hooks'
import { TASK_STATUSES } from '@/api/record-types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Input, KPI, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { dueState, humanise } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/**
 * Tasks: mine first, on the current project by default. A task is the one
 * record that follows the person across projects, so the scope can widen.
 */
export default function TasksScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const [mine, setMine] = useState(true)
  const [scope, setScope] = useState<'project' | 'all'>(projectId ? 'project' : 'all')
  const [status, setStatus] = useState<string | null>(null)
  const [overdue, setOverdue] = useState(false)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')

  const filters = useMemo(() => ({ mine, projectId: scope === 'project' && projectId ? projectId : undefined, status: status ?? undefined, overdue: overdue || undefined, search: search || undefined }), [mine, scope, projectId, status, overdue, search])
  const tasks = useTasks(filters)
  const rows = tasks.data?.rows ?? []

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  return (
    <Screen scroll={false} testID="screen-tasks">
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.kpis}>
              <KPI label="Open" value={String(tasks.data?.summary.open ?? '—')} />
              <KPI label="Overdue" value={String(tasks.data?.summary.overdue ?? '—')} tone={(tasks.data?.summary.overdue ?? 0) > 0 ? 'error' : 'default'} onPress={() => setOverdue((v) => !v)} />
            </View>
            <Input label="Find" placeholder="Number or title" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="none" testID="task-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="Mine" selected={mine} onPress={() => setMine(true)} testID="task-chip-mine" />
              <FilterChip label="All I can see" selected={!mine} onPress={() => setMine(false)} testID="task-chip-all" />
              {projectId ? <FilterChip label="This project" selected={scope === 'project'} onPress={() => setScope('project')} testID="task-chip-project" /> : null}
              <FilterChip label="All projects" selected={scope === 'all'} onPress={() => setScope('all')} testID="task-chip-scope-all" />
              <FilterChip label="Overdue" selected={overdue} onPress={() => setOverdue((v) => !v)} testID="task-chip-overdue" />
              {TASK_STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`task-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={tasks.dataUpdatedAt || undefined} isFetching={tasks.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const state = item.dueDate && item.status !== 'done' && item.status !== 'canceled' ? dueState(item.dueDate) : null
          return (
            <RecordRow
              reference={item.taskNumber}
              title={item.title}
              status={item.status}
              meta={[humanise(item.label), scope === 'all' ? item.project?.name : null, item.assigneeName && !mine ? item.assigneeName : null, item.priority !== 'medium' ? `${humanise(item.priority)} priority` : null].filter(Boolean).join(' · ') || undefined}
              trailing={state?.label}
              trailingTone={item.isOverdue ? 'error' : (state?.tone ?? 'muted')}
              onPress={() => router.push(`/tasks/${item.id}`)}
              testID={`task-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          tasks.isPending ? (
            <SkeletonList rows={4} />
          ) : tasks.isError ? (
            <ErrorState message={userMessage(tasks.error)} onRetry={() => void tasks.refetch()} />
          ) : (
            <EmptyState title={mine ? 'Nothing assigned to you' : 'No tasks match'} body={mine ? 'Tasks assigned to you from meetings and records appear here.' : undefined} />
          )
        }
        ListFooterComponent={
          tasks.data?.pagination.nextCursor ? (
            <Text variant="caption" tone="muted" style={styles.footer}>
              Showing the first {rows.length}. Narrow the list to find the rest.
            </Text>
          ) : null
        }
        onRefresh={() => void tasks.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
  footer: { paddingTop: spacing.md },
})
