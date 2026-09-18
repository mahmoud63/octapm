import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useInventoryItems } from '@/api/inventory-hooks'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, RecordRow, SkeletonList, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { quantity } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/** The item master with derived stock; the server searches and flags low stock. */
export default function InventoryItemsScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const params = useLocalSearchParams<{ lowStock?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [lowStock, setLowStock] = useState(params.lowStock === '1')
  const filters = useMemo(() => ({ search: search || undefined, lowStock }), [search, lowStock])
  const items = useInventoryItems(projectId, filters)
  const rows = items.data ?? []

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-items">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-items">
      <FlatList
        data={rows}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Input label="Find" placeholder="Name, SKU or code" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="none" testID="items-search" />
              </View>
              <Button title="Scan" variant="secondary" onPress={() => router.push('/inventory/scan')} testID="items-scan" />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={!lowStock} onPress={() => setLowStock(false)} testID="items-chip-all" />
              <FilterChip label="Low stock" selected={lowStock} onPress={() => setLowStock(true)} testID="items-chip-low" />
            </ScrollView>
            <Freshness updatedAt={items.dataUpdatedAt || undefined} isFetching={items.isFetching} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.sku}
            title={item.name}
            status={item.status === 'archived' ? 'archived' : item.onHand <= 0 ? 'out_of_stock' : item.belowReorder ? 'low_stock' : 'in_stock'}
            meta={[item.category, `${quantity(item.available, item.unit)} available`, item.reserved ? `${quantity(item.reserved, item.unit)} reserved` : null].filter(Boolean).join(' · ')}
            trailing={quantity(item.onHand, item.unit)}
            trailingTone={item.onHand <= 0 ? 'error' : item.belowReorder ? 'warning' : 'muted'}
            onPress={() => router.push(`/inventory/items/${item.id}`)}
            testID={`item-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          items.isPending ? (
            <SkeletonList rows={5} />
          ) : items.isError ? (
            <ErrorState message={userMessage(items.error)} onRetry={() => void items.refetch()} />
          ) : (
            <EmptyState title={lowStock ? 'Nothing is below its reorder level' : 'No items match'} />
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
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
