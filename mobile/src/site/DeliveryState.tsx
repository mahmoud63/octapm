import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { usePurchaseOrders } from '@/api/inventory-hooks'
import type { PurchaseOrder } from '@/api/inventory-types'
import { Badge, Button, Text, spacing } from '@/design-system'

/** What the order says about itself, in the words a storekeeper would use. */
const ORDER_STATE: Record<string, { label: string; tone: 'neutral' | 'warning' | 'success' }> = {
  not_received: { label: 'Awaiting delivery', tone: 'warning' },
  partial: { label: 'Part received', tone: 'warning' },
  received: { label: 'Received', tone: 'success' },
}

/**
 * What became of the order this delivery was against.
 *
 * A site engineer writing "a truck arrived with 300 bags" has recorded an
 * observation, and that is all it is. Three hundred bags are not three hundred
 * bags in controlled stock: the storekeeper still has to count them, reject
 * what is broken and say which bin they went in. So this never claims the
 * delivery row was received — it reports the *order's* state, which the server
 * owns, and offers the way to the receipt for whoever is allowed to post one.
 *
 * The daily report moves no stock and no money. A receipt moves stock; cost
 * follows later, when material is issued to the work.
 */
export function DeliveryState({
  projectId,
  poRef,
  canReceive,
  testID,
}: {
  projectId: string
  poRef: string | null | undefined
  canReceive: boolean
  testID: string
}) {
  const router = useRouter()
  const orders = usePurchaseOrders(projectId)

  // poRef is free text on the daily log, so this is a lookup, not a join: a
  // reference that matches nothing is simply an order nobody has raised here.
  const order = useMemo<PurchaseOrder | null>(() => {
    const ref = poRef?.trim().toLowerCase()
    if (!ref) return null
    return (orders.data ?? []).find((o) => o.ref?.trim().toLowerCase() === ref) ?? null
  }, [orders.data, poRef])

  if (!poRef?.trim()) {
    return (
      <Text variant="caption" tone="muted" testID={`${testID}-unlinked`}>
        No order reference — observed on site only.
      </Text>
    )
  }

  if (orders.isPending) return null

  if (!order) {
    return (
      <Text variant="caption" tone="muted" testID={`${testID}-unknown`}>
        {poRef} is not an order on this project.
      </Text>
    )
  }

  const state = ORDER_STATE[order.warehouseStatus] ?? { label: 'Awaiting delivery', tone: 'warning' as const }

  return (
    <View style={styles.row} testID={`${testID}-order`}>
      <Text variant="caption" tone="muted" style={styles.grow}>
        {order.ref}
        {order.supplier ? ` · ${order.supplier}` : ''}
      </Text>
      <Badge label={state.label} tone={state.tone} />
      {canReceive && order.warehouseStatus !== 'received' ? (
        <Button
          title="Receive"
          variant="ghost"
          onPress={() => router.push(`/inventory/receive/${order.id}` as never)}
          testID={`${testID}-receive`}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
})
