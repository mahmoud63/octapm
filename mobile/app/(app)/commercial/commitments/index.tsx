import { useRouter } from 'expo-router'
import { FlatList, StyleSheet, View } from 'react-native'
import { useCommitments } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise, money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'
import { listPerformance } from '@/components/listProps'

/** Subcontracts and purchase-order commitments, read only. */
export default function CommitmentsScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const commitments = useCommitments(projectId)

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-commitments">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-commitments">
      <FlatList {...listPerformance}
        data={commitments.data ?? []}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Freshness updatedAt={commitments.dataUpdatedAt || undefined} isFetching={commitments.isFetching} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.ref}
            title={item.title}
            status={item.status}
            meta={[humanise(item.type), item.vendor?.name ?? item.supplier, item.ballInCourt?.label].filter(Boolean).join(' · ')}
            trailing={money(item.revised, item.currency)}
            trailingTone={item.ballInCourt?.isYou ? 'warning' : 'muted'}
            onPress={() => router.push(`/commercial/commitments/${item.id}`)}
            testID={`commitment-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          commitments.isPending ? (
            <SkeletonList rows={4} />
          ) : commitments.isError ? (
            <ErrorState message={userMessage(commitments.error)} onRetry={() => void commitments.refetch()} />
          ) : (
            <EmptyState title="No commitments yet" />
          )
        }
        onRefresh={() => void commitments.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
