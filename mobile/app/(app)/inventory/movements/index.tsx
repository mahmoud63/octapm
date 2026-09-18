import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useStockMovements, useWarehouses } from '@/api/inventory-hooks'
import { MOVEMENT_TYPES } from '@/api/inventory-types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { useRememberedWarehouse } from '@/inventory/preferences'
import { useProjectStore } from '@/projects/store'
import { dateTime, humanise, quantity } from '@/utilities/format'
import { listPerformance } from '@/components/listProps'

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** The movement ledger, newest first: by warehouse, by type, or for one item. */
export default function MovementsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ itemId?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const warehouses = useWarehouses(projectId)
  const remembered = useRememberedWarehouse(projectId)
  const [warehouseId, setWarehouseId] = useState<string | null | undefined>(undefined)
  const [type, setType] = useState<string | null>(null)
  const effectiveWarehouse = warehouseId === undefined ? (params.itemId ? null : remembered.warehouseId) : warehouseId
  // Inventory is organisation-level and most movements carry no project, so the ledger is never filtered by project: by warehouse, by type, or for one item.
  const filters = useMemo(() => ({ itemId: params.itemId || undefined, warehouseId: effectiveWarehouse ?? undefined, type: type ?? undefined, limit: 200 }), [params.itemId, effectiveWarehouse, type])
  const movements = useStockMovements(filters)
  const warehouseOptions = useMemo(() => (warehouses.data ?? []).map((w) => ({ id: w.id, label: w.name, sublabel: w.code })), [warehouses.data])
  const rows = movements.data ?? []

  return (
    <Screen scroll={false} testID="screen-movements">
      <FlatList {...listPerformance}
        data={rows}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {params.itemId ? (
              <Text tone="muted">Movements of one item.</Text>
            ) : (
              <PickerField label="Warehouse" options={warehouseOptions} value={effectiveWarehouse} onChange={(v) => setWarehouseId((v as string | null) ?? null)} loading={warehouses.isPending} placeholder="All warehouses" testID="movements-warehouse" />
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={type === null} onPress={() => setType(null)} testID="movements-chip-all" />
              {MOVEMENT_TYPES.map((t) => (
                <FilterChip key={t} label={humanise(t)} selected={type === t} onPress={() => setType(type === t ? null : t)} testID={`movements-chip-${t}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={movements.dataUpdatedAt || undefined} isFetching={movements.isFetching} />
          </View>
        }
        renderItem={({ item: m }) => (
          <View style={[styles.row, { borderColor: theme.colors.border }]} testID={`movement-${m.id}`}>
            <View style={styles.grow}>
              <Text>{`${humanise(m.type)} · ${m.item?.name ?? m.itemId} · ${signed(m.quantity)} ${m.item?.unit ?? ''}`.trim()}</Text>
              <Text variant="caption" tone="muted">
                {[m.warehouse, m.location, dateTime(m.occurredAt), m.reference ?? m.notes].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {m.balanceAfter != null ? <Text tone="muted">{quantity(m.balanceAfter, m.item?.unit)}</Text> : null}
          </View>
        )}
        ListEmptyComponent={
          movements.isPending ? (
            <SkeletonList rows={5} />
          ) : movements.isError ? (
            <ErrorState message={userMessage(movements.error)} onRetry={() => void movements.refetch()} />
          ) : (
            <EmptyState title="No movements match" action={params.itemId ? { title: 'Back to the item', onPress: () => router.back() } : undefined} />
          )
        }
        onRefresh={() => void movements.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  list: { paddingBottom: spacing.xl },
})
