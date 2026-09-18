import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useInventorySummary, useWarehouses } from '@/api/inventory-hooks'
import { Freshness } from '@/components/Freshness'
import { PickerField } from '@/components/PickerField'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, Card, EmptyState, ErrorState, KPI, SkeletonList, Text, spacing } from '@/design-system'
import { useRememberedWarehouse } from '@/inventory/preferences'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { humanise, money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/**
 * The storekeeper's home: which warehouse this device works from, the
 * server's tiles, and the doors to scan, items, goods in, transfers and
 * the ledger. Nothing is computed here; the tiles are polled, since the
 * server sends no inventory events.
 */
export default function InventoryHomeScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const summary = useInventorySummary(projectId)
  const warehouses = useWarehouses(projectId)
  const remembered = useRememberedWarehouse(projectId)
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const warehouseOptions = useMemo(() => (warehouses.data ?? []).filter((w) => w.status !== 'archived').map((w) => ({ id: w.id, label: w.name, sublabel: [w.code, humanise(w.kind)].filter(Boolean).join(' · ') })), [warehouses.data])

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-inventory">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }
  if (permissions.matrix && !permissions.allows('inventory', 'read')) {
    return (
      <Screen testID="screen-inventory">
        <ProjectSwitch project={project} />
        <EmptyState title="Inventory is not part of your role" />
      </Screen>
    )
  }

  const s = summary.data
  const doors = [
    { id: 'scan', title: 'Scan', route: '/inventory/scan', show: true },
    { id: 'items', title: 'Items', route: '/inventory/items', show: true },
    { id: 'receive', title: 'Goods in', route: '/inventory/receive', show: permissions.allowsTransition('inventory', 'stock.receive') },
    { id: 'transfers', title: 'Transfers', route: '/inventory/transfers', show: true },
    { id: 'movements', title: 'Movements', route: '/inventory/movements', show: true },
  ].filter((d) => d.show)

  return (
    <Screen contentStyle={styles.content} testID="screen-inventory">
      <ProjectSwitch project={project} />
      <PickerField label="Working from" options={warehouseOptions} value={remembered.warehouseId} onChange={(v) => void remembered.remember(v as string | null)} loading={warehouses.isPending} placeholder="Choose a warehouse" testID="inventory-warehouse" />
      {summary.isPending ? (
        <SkeletonList rows={3} />
      ) : summary.isError ? (
        <ErrorState message={userMessage(summary.error)} onRetry={() => void summary.refetch()} />
      ) : s ? (
        <>
          <View style={styles.kpis}>
            <KPI label="Stock value" value={money(s.totalValue, project?.currency)} />
            <KPI label="Items" value={String(s.itemCount)} onPress={() => router.push('/inventory/items')} />
            <KPI label="Low stock" value={String(s.lowStock)} tone={s.lowStock > 0 ? 'warning' : 'default'} onPress={() => router.push('/inventory/items?lowStock=1' as never)} />
            <KPI label="Out of stock" value={String(s.outOfStock)} tone={s.outOfStock > 0 ? 'error' : 'default'} onPress={() => router.push('/inventory/items?lowStock=1' as never)} />
            <KPI label="Damaged" value={String(s.damaged)} tone={s.damaged > 0 ? 'warning' : 'default'} />
            <KPI label="Quarantined" value={String(s.quarantined)} tone={s.quarantined > 0 ? 'warning' : 'default'} />
          </View>
          {s.byWarehouse.length ? (
            <Card>
              <View style={styles.stack}>
                <Text variant="label" label tone="muted">
                  By warehouse
                </Text>
                {s.byWarehouse.map((w) => (
                  <View key={w.id} style={styles.row} testID={`inventory-warehouse-${w.id}`}>
                    <Text style={styles.grow}>{w.name}</Text>
                    <Text tone="muted">{`${w.lines} line${w.lines === 1 ? '' : 's'} · ${money(w.value, project?.currency)}`}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
          <Freshness updatedAt={summary.dataUpdatedAt || undefined} isFetching={summary.isFetching} />
        </>
      ) : null}
      <View style={styles.doors} testID="inventory-doors">
        {doors.map((d) => (
          <Button key={d.id} title={d.title} variant={d.id === 'scan' ? 'primary' : 'secondary'} onPress={() => router.push(d.route as never)} testID={`inventory-${d.id}`} />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        Stock movements are sent only while connected and are never queued: the store cannot tell a repeat from a new movement. A goods receipt is the exception; it carries a receipt number, so sending it twice counts once.
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  doors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
