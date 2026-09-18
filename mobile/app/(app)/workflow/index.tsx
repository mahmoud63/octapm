import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { useMySteps } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { dueState } from '@/utilities/format'

/**
 * The approvals waiting on this person across every project: each row is a
 * workflow step assigned to them and still current. Answering it is the
 * one safe way to decide a running approval from a phone.
 */
export default function WorkflowInboxScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const steps = useMySteps()
  const [scope, setScope] = useState<'project' | 'all'>(projectId ? 'project' : 'all')
  const rows = useMemo(() => (steps.data ?? []).filter((s) => scope === 'all' || s.projectId === projectId), [steps.data, scope, projectId])

  return (
    <Screen scroll={false} testID="screen-workflow">
      <FlatList
        data={rows}
        keyExtractor={(s) => s.assignmentId}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <FilterChip label="This project" selected={scope === 'project'} onPress={() => setScope('project')} testID="workflow-chip-project" />
              <FilterChip label="All projects" count={steps.data?.length} selected={scope === 'all'} onPress={() => setScope('all')} testID="workflow-chip-all" />
            </ScrollView>
            <Text variant="caption" tone="muted">
              Each item is a step assigned to you. Your answer moves the record; the record itself is not changed here.
            </Text>
            <Freshness updatedAt={steps.dataUpdatedAt || undefined} isFetching={steps.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const due = item.dueAt ? dueState(item.dueAt) : null
          return (
            <RecordRow
              reference={`${item.toolLabel}${item.recordRef ? ` ${item.recordRef}` : ''}`}
              title={item.recordTitle ?? item.stepName}
              status={item.overdue ? 'overdue' : 'awaiting_you'}
              meta={[item.stepName, item.project?.name, item.template?.name].filter(Boolean).join(' · ')}
              trailing={due?.label}
              trailingTone={due?.tone ?? 'muted'}
              onPress={() => router.push({ pathname: '/workflow/[id]', params: { id: item.instanceId, projectId: item.projectId } } as never)}
              testID={`step-row-${item.assignmentId}`}
            />
          )
        }}
        ListEmptyComponent={
          steps.isPending ? (
            <SkeletonList rows={4} />
          ) : steps.isError ? (
            <ErrorState message={userMessage(steps.error)} onRetry={() => void steps.refetch()} />
          ) : (
            <EmptyState title="Nothing is waiting on you" />
          )
        }
        onRefresh={() => void steps.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
