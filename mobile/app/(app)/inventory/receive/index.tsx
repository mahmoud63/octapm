import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { usePurchaseOrders } from '@/api/inventory-hooks'
import { RECEIVABLE_PO_STATUSES } from '@/api/inventory-types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Input, RecordRow, SkeletonList, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { day, dueState, money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

const receivable = new Set<string>(RECEIVABLE_PO_STATUSES)

/** Purchase orders a delivery can be received against; the rest are shown on request. */
export default function GoodsInScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const orders = usePurchaseOrders(projectId)
  const [mode, setMode] = useState<'receivable' | 'all'>('receivable')
  const [term, setTerm] = useState('')

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase()
    return (orders.data ?? [])
      .filter((o) => (mode === 'receivable' ? receivable.has(o.status) : true))
      .filter((o) => !q || [o.ref, o.supplier, ...o.lines.map((l) => l.description)].some((v) => v?.toLowerCase().includes(q)))
  }, [orders.data, mode, term])

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-goods-in">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-goods-in">
      <FlatList
        data={rows}
        keyExtractor={(o) => o.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Input label="Find" placeholder="Order, supplier or item" value={term} onChangeText={setTerm} autoCapitalize="none" returnKeyType="search" testID="goods-in-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="Awaiting delivery" selected={mode === 'receivable'} onPress={() => setMode('receivable')} testID="goods-in-chip-receivable" />
              <FilterChip label="All orders" selected={mode === 'all'} onPress={() => setMode('all')} testID="goods-in-chip-all" />
            </ScrollView>
            <Freshness updatedAt={orders.dataUpdatedAt || undefined} isFetching={orders.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const outstanding = item.lines.filter((l) => l.outstandingQty > 0).length
          const promised = item.promisedDate && receivable.has(item.status) ? dueState(item.promisedDate) : null
          return (
            <RecordRow
              reference={item.ref}
              title={item.supplier ?? 'Purchase order'}
              status={item.status}
              meta={[`${item.lines.length} line${item.lines.length === 1 ? '' : 's'}`, outstanding ? `${outstanding} outstanding` : null, item.value != null ? money(item.value, item.currency) : null, item.promisedDate ? `Promised ${day(item.promisedDate)}` : null].filter(Boolean).join(' · ')}
              trailing={promised?.label}
              trailingTone={promised?.tone ?? 'muted'}
              onPress={() => router.push(`/inventory/receive/${item.id}`)}
              testID={`po-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          orders.isPending ? (
            <SkeletonList rows={4} />
          ) : orders.isError ? (
            <ErrorState message={userMessage(orders.error)} onRetry={() => void orders.refetch()} />
          ) : (
            <EmptyState title={mode === 'receivable' ? 'No deliveries are awaited' : 'No purchase orders match'} />
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
