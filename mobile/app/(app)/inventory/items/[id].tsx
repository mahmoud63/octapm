import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useInventoryItem, useItemStock, useStockMovements } from '@/api/inventory-hooks'
import type { StockMoveKind } from '@/api/inventory-types'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { MOVE_TITLES, StockMoveSheet } from '@/components/StockMoveSheet'
import { Fact } from '@/components/WorkflowRecordCard'
import { Button, Card, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { useRememberedWarehouse } from '@/inventory/preferences'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money, quantity } from '@/utilities/format'

const MOVES: { kind: StockMoveKind; transition: string }[] = [
  { kind: 'issue', transition: 'stock.issue' },
  { kind: 'return', transition: 'stock.return' },
  { kind: 'reserve', transition: 'stock.issue' },
  { kind: 'receive', transition: 'stock.receive' },
  { kind: 'adjust', transition: 'stock.adjust' },
  { kind: 'damage', transition: 'stock.adjust' },
  { kind: 'quarantine', transition: 'stock.adjust' },
  { kind: 'release', transition: 'stock.adjust' },
]

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** One item: balances, where the stock sits, the recent movements, and the movements this role may make. */
export default function InventoryItemScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const item = useInventoryItem(id ?? null)
  const stock = useItemStock(item.data?.sku ?? null)
  const movements = useStockMovements({ itemId: id, limit: 20 }, !!id)
  const remembered = useRememberedWarehouse(projectId)
  const [move, setMove] = useState<StockMoveKind | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  if (!id) {
    return (
      <Screen testID="screen-item">
        <ErrorState message="No item was chosen." onRetry={() => router.replace('/inventory/items')} />
      </Screen>
    )
  }
  if (item.isPending) {
    return (
      <Screen testID="screen-item">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (item.isError) {
    return (
      <Screen testID="screen-item">
        <ErrorState message={userMessage(item.error)} onRetry={() => void item.refetch()} />
      </Screen>
    )
  }

  const it = item.data
  const allowed = MOVES.filter((m) => permissions.allowsTransition('inventory', m.transition))

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-item">
        <RecordHeader reference={it.sku} title={it.name} status={it.status === 'archived' ? 'archived' : it.onHand <= 0 ? 'out_of_stock' : it.belowReorder ? 'low_stock' : 'in_stock'} meta={[it.category, it.unit, it.barcode ? `Barcode ${it.barcode}` : null, it.manufacturer].filter((v): v is string => !!v)} testID="item-header" />
        <View style={styles.kpis}>
          <KPI label="Available" value={quantity(it.available, it.unit)} tone={it.available <= 0 ? 'error' : it.belowReorder ? 'warning' : 'default'} />
          <KPI label="On hand" value={quantity(it.onHand, it.unit)} />
          <KPI label="Reserved" value={quantity(it.reserved, it.unit)} />
          <KPI label="In transit" value={quantity(it.inTransit, it.unit)} />
          <KPI label="Damaged" value={quantity(it.damaged, it.unit)} tone={it.damaged > 0 ? 'warning' : 'default'} />
          <KPI label="Quarantined" value={quantity(it.quarantined, it.unit)} tone={it.quarantined > 0 ? 'warning' : 'default'} />
        </View>
        {notice ? (
          <Card edge={theme.colors.success}>
            <Text testID="item-notice">{notice}</Text>
          </Card>
        ) : null}
        {allowed.length ? (
          <Card>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Move stock
              </Text>
              <View style={styles.actions}>
                {allowed.map((m) => (
                  <Button key={m.kind} title={MOVE_TITLES[m.kind]} variant={m.kind === 'issue' ? 'primary' : 'secondary'} onPress={() => { setNotice(null); setMove(m.kind) }} testID={`item-move-${m.kind}`} />
                ))}
              </View>
            </View>
          </Card>
        ) : null}
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Where it is
            </Text>
            {stock.isPending ? (
              <SkeletonList rows={2} />
            ) : stock.isError ? (
              <Text tone="muted">{userMessage(stock.error)}</Text>
            ) : stock.data && stock.data.length ? (
              stock.data.map((row, i) => (
                <View key={`${row.warehouseId}-${row.locationId ?? i}`} style={[styles.row, { borderColor: theme.colors.border }]} testID={`item-stock-${row.warehouseId}`}>
                  <Text style={styles.grow}>{[row.warehouse, row.location].filter(Boolean).join(' · ')}</Text>
                  <Text tone="muted">{`${quantity(row.available, it.unit)} of ${quantity(row.onHand, it.unit)}`}</Text>
                </View>
              ))
            ) : (
              <Text tone="muted">No stock in any warehouse.</Text>
            )}
          </View>
        </Card>
        <Card>
          <View style={styles.stack}>
            <Fact label="Reorder level" value={it.reorderLevel != null ? quantity(it.reorderLevel, it.unit) : null} />
            <Fact label="Average cost" value={it.averageCost != null ? money(it.averageCost, null) : null} />
            <Fact label="Last purchase price" value={it.lastPurchasePrice != null ? money(it.lastPurchasePrice, null) : null} />
            <Fact label="Lead time" value={it.leadTimeDays != null ? `${it.leadTimeDays} day${it.leadTimeDays === 1 ? '' : 's'}` : null} />
            <Fact label="Specification" value={it.specification} />
            <Fact label="Notes" value={it.notes} />
          </View>
        </Card>
        <Card>
          <View style={styles.stack}>
            <View style={styles.row}>
              <Text variant="label" label tone="muted" style={styles.grow}>
                Recent movements
              </Text>
              <Button title="All" variant="ghost" onPress={() => router.push({ pathname: '/inventory/movements', params: { itemId: it.id } } as never)} testID="item-movements-all" />
            </View>
            {movements.isPending ? (
              <SkeletonList rows={3} />
            ) : movements.data && movements.data.length ? (
              movements.data.map((m) => (
                <View key={m.id} style={[styles.row, { borderColor: theme.colors.border }]} testID={`movement-${m.id}`}>
                  <View style={styles.grow}>
                    <Text>{`${humanise(m.type)} · ${signed(m.quantity)} ${it.unit}`}</Text>
                    <Text variant="caption" tone="muted">
                      {[m.warehouse, day(m.occurredAt), m.reference ?? m.notes].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {m.balanceAfter != null ? <Text tone="muted">{quantity(m.balanceAfter, it.unit)}</Text> : null}
                </View>
              ))
            ) : (
              <Text tone="muted">No movements yet.</Text>
            )}
          </View>
        </Card>
        {failure ? (
          <Text tone="error" accessibilityRole="alert">
            {failure}
          </Text>
        ) : null}
      </Screen>
      {move ? (
        <StockMoveSheet
          visible={!!move}
          kind={move}
          item={it}
          projectId={projectId}
          defaultWarehouseId={remembered.warehouseId}
          onCancel={() => setMove(null)}
          onDone={(summary) => {
            setMove(null)
            setFailure(null)
            setNotice(summary)
          }}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
})
