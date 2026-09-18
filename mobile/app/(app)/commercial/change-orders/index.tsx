import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { useChangeOrders } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise, money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

const STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const

/** Change orders, read only: the contract instruments the change events became. */
export default function ChangeOrdersScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const [status, setStatus] = useState<string | null>(null)
  const orders = useChangeOrders(projectId, status ?? undefined)
  const currency = projects.data?.find((p) => p.id === projectId)?.currency

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-change-orders">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-change-orders">
      <FlatList
        data={orders.data ?? []}
        keyExtractor={(o) => o.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="caption" tone="muted">
              Change orders are raised and decided by the project manager and the QS on the web, or through your approvals.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <FilterChip label="All" selected={status === null} onPress={() => setStatus(null)} testID="change-orders-chip-all" />
              {STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`change-orders-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={orders.dataUpdatedAt || undefined} isFetching={orders.isFetching} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.ref}
            title={item.description}
            status={item.status}
            meta={[item.category ? humanise(item.category) : null, item.scheduleImpact ? `${item.scheduleImpact} d schedule` : null, item.approvedAt ? `Approved ${item.approvedAt.slice(0, 10)}` : null].filter(Boolean).join(' · ')}
            trailing={money(item.value, currency)}
            onPress={() => router.push(`/commercial/change-orders/${item.id}`)}
            testID={`change-order-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          orders.isPending ? (
            <SkeletonList rows={4} />
          ) : orders.isError ? (
            <ErrorState message={userMessage(orders.error)} onRetry={() => void orders.refetch()} />
          ) : (
            <EmptyState title="No change orders match" />
          )
        }
        onRefresh={() => void orders.refetch()}
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
