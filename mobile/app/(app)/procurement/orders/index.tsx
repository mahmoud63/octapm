import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { useRegisterOrders } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise, money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'
import { listPerformance } from '@/components/listProps'

const STATUSES = ['planned', 'draft', 'pending_approval', 'approved', 'issued', 'acknowledged', 'partial', 'received', 'closed'] as const

/** The commercial purchase-order register, read only; the server filters by status. */
export default function OrdersScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const [status, setStatus] = useState<string | null>(null)
  const orders = useRegisterOrders(projectId, status ?? undefined)

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-orders">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-orders">
      <FlatList {...listPerformance}
        data={orders.data ?? []}
        keyExtractor={(o) => o.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <FilterChip label="All" selected={status === null} onPress={() => setStatus(null)} testID="orders-chip-all" />
              {STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`orders-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={orders.dataUpdatedAt || undefined} isFetching={orders.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const promised = item.promisedDate && !['received', 'closed', 'cancelled'].includes(item.status) ? dueState(item.promisedDate) : null
          return (
            <RecordRow
              reference={item.ref}
              title={item.item ?? item.supplier ?? 'Purchase order'}
              status={item.lifecycleStatus || item.status}
              meta={[item.supplier, item.ballInCourt?.label, item.requiredBy ? `Required ${day(item.requiredBy)}` : null].filter(Boolean).join(' · ')}
              trailing={promised ? promised.label : money(item.value, item.currency)}
              trailingTone={promised ? promised.tone : item.ballInCourt?.isYou ? 'warning' : 'muted'}
              onPress={() => router.push(`/procurement/orders/${item.id}`)}
              testID={`order-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          orders.isPending ? (
            <SkeletonList rows={4} />
          ) : orders.isError ? (
            <ErrorState message={userMessage(orders.error)} onRetry={() => void orders.refetch()} />
          ) : (
            <EmptyState title="No purchase orders match" />
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
