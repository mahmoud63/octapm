import { useRouter } from 'expo-router'
import { FlatList, StyleSheet, View } from 'react-native'
import { useLongLead } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise } from '@/utilities/format'

/** The long-lead register, read only: what must be ordered when, and where it stands. */
export default function LongLeadScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const items = useLongLead(projectId)

  if (!projectId) {
    return (
      <Screen testID="screen-long-lead">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-long-lead">
      <FlatList
        data={items.data ?? []}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="caption" tone="muted">
              Long-lead items are planned on the web; this register shows where each one stands.
            </Text>
            <Freshness updatedAt={items.dataUpdatedAt || undefined} isFetching={items.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const orderBy = item.orderBy && item.status === 'not_ordered' ? dueState(item.orderBy) : null
          return (
            <RecordRow
              reference={item.criticality ? humanise(item.criticality) : 'Long lead'}
              title={item.item}
              status={item.status}
              meta={[item.supplier, item.activity?.name, item.leadWeeks != null ? `${item.leadWeeks} wk lead` : null, item.expectedDeliveryDate ? `Expected ${day(item.expectedDeliveryDate)}` : null, item.warehouseStatus ? humanise(item.warehouseStatus) : null].filter(Boolean).join(' · ')}
              trailing={orderBy ? `Order ${orderBy.label.toLowerCase()}` : item.risk ? `${humanise(item.risk)} risk` : undefined}
              trailingTone={orderBy ? orderBy.tone : item.risk === 'high' ? 'error' : 'muted'}
              testID={`long-lead-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          items.isPending ? (
            <SkeletonList rows={4} />
          ) : items.isError ? (
            <ErrorState message={userMessage(items.error)} onRetry={() => void items.refetch()} />
          ) : (
            <EmptyState title="No long-lead items" />
          )
        }
        onRefresh={() => void items.refetch()}
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
