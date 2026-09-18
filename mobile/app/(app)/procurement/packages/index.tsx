import { useRouter } from 'expo-router'
import { FlatList, StyleSheet, View } from 'react-native'
import { useProcurementOverview } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { day, dueState } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/** Procurement packages with their dates and the alerts against them, read only. */
export default function PackagesScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const overview = useProcurementOverview(projectId)

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-packages">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-packages">
      <FlatList
        data={overview.data?.packages ?? []}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Freshness updatedAt={overview.dataUpdatedAt || undefined} isFetching={overview.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const open = (item.leadTimeAlerts ?? []).filter((a) => a.status === 'open').length
          const order = item.latestOrderDate && item.status !== 'awarded' && item.status !== 'in_delivery' && item.status !== 'closed' ? dueState(item.latestOrderDate) : null
          return (
            <RecordRow
              reference={item.packageNumber}
              title={item.title}
              status={item.status}
              meta={[item.supplier?.name, item.activity?.name, item.requiredOnSiteDate ? `On site ${day(item.requiredOnSiteDate)}` : null, open ? `${open} alert${open === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
              trailing={order ? `Order ${order.label.toLowerCase()}` : undefined}
              trailingTone={order?.tone ?? 'muted'}
              onPress={() => router.push(`/procurement/packages/${item.id}`)}
              testID={`package-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          overview.isPending ? (
            <SkeletonList rows={4} />
          ) : overview.isError ? (
            <ErrorState message={userMessage(overview.error)} onRetry={() => void overview.refetch()} />
          ) : (
            <EmptyState title="No packages yet" />
          )
        }
        onRefresh={() => void overview.refetch()}
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
