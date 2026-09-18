import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useTransfers } from '@/api/inventory-hooks'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, RecordRow, SkeletonList, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

const STATUSES = ['draft', 'in_transit', 'received'] as const

/** Stock on the move between warehouses; the server filters by status. */
export default function TransfersScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const [status, setStatus] = useState<string | null>(null)
  const transfers = useTransfers(status ?? undefined)
  const rows = transfers.data ?? []

  return (
    <Screen scroll={false} testID="screen-transfers">
      <FlatList
        data={rows}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {permissions.allowsTransition('inventory', 'stock.transfer') ? <Button title="New transfer" onPress={() => router.push('/inventory/transfers/new')} testID="transfer-new" /> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={status === null} onPress={() => setStatus(null)} testID="transfers-chip-all" />
              {STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`transfers-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={transfers.dataUpdatedAt || undefined} isFetching={transfers.isFetching} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.ref}
            title={`${item.fromWarehouse ?? 'From'} → ${item.toWarehouse ?? 'To'}`}
            status={item.status}
            meta={[`${item.lines.length} line${item.lines.length === 1 ? '' : 's'}`, item.reason, item.receivedAt ? `Received ${day(item.receivedAt)}` : item.dispatchedAt ? `Dispatched ${day(item.dispatchedAt)}` : `Created ${day(item.createdAt)}`].filter(Boolean).join(' · ')}
            onPress={() => router.push(`/inventory/transfers/${item.id}`)}
            testID={`transfer-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          transfers.isPending ? (
            <SkeletonList rows={4} />
          ) : transfers.isError ? (
            <ErrorState message={userMessage(transfers.error)} onRetry={() => void transfers.refetch()} />
          ) : (
            <EmptyState title="No transfers match" />
          )
        }
        onRefresh={() => void transfers.refetch()}
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
