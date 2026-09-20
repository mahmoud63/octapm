import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useRegisterOrder } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { RECEIVABLE_PO_STATUSES } from '@/api/inventory-types'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { openOnWeb, webPathForTarget } from '@/navigation/links'
import { Evidence } from '@/components/Evidence'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money, quantity } from '@/utilities/format'

const receivable = new Set<string>(RECEIVABLE_PO_STATUSES)

/** One purchase order from the commercial register: who holds it, the money, the lines and the deliveries against it. Read only, except receiving under Inventory. */
export default function OrderScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const order = useRegisterOrder(projectId, id ?? null)

  if (!projectId || !id) {
    return (
      <Screen testID="screen-order">
        <ErrorState message="Choose a project to open this order." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (order.isPending) {
    return (
      <Screen testID="screen-order">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (order.isError) {
    return (
      <Screen testID="screen-order">
        <ErrorState message={userMessage(order.error)} onRetry={() => void order.refetch()} />
      </Screen>
    )
  }

  const o = order.data
  const canReceive = receivable.has(o.status) && permissions.allowsTransition('inventory', 'stock.receive')

  return (
    <Screen contentStyle={styles.content} testID="screen-order">
      <RecordHeader reference={o.ref} title={o.item ?? o.supplier ?? 'Purchase order'} status={o.lifecycleStatus || o.status} meta={[o.supplier, o.orderDate ? `Ordered ${day(o.orderDate)}` : null, o.requiredBy ? `Required ${day(o.requiredBy)}` : null, o.promisedDate ? `Promised ${day(o.promisedDate)}` : null].filter((v): v is string => !!v)} testID="order-header" />
      {o.ballInCourt.label ? (
        <View style={styles.row}>
          <Text variant="label" label tone="muted">
            Ball in court
          </Text>
          <Badge label={o.ballInCourt.label} tone={o.ballInCourt.isYou ? 'warning' : 'info'} />
        </View>
      ) : null}
      <View style={styles.kpis}>
        <KPI label="Value" value={money(o.value, o.currency)} />
        <KPI label="Invoiced" value={money(o.invoicedAmount, o.currency)} qualifier={humanise(o.invoiceStatus)} />
        <KPI label="Delivery" value={humanise(o.warehouseStatus)} tone={o.warehouseStatus === 'received' ? 'success' : o.warehouseStatus === 'partial' ? 'warning' : 'default'} />
      </View>
      {canReceive ? <Button title="Receive delivery" size="lg" fullWidth onPress={() => router.push(`/inventory/receive/${o.id}`)} testID="order-receive" /> : null}
      <Card>
        <View style={styles.stack}>
          <Fact label="Supplier contact" value={o.supplierEmail} />
          <Fact label="Deliver to" value={[o.deliveryLocation, o.deliveryAddress].filter(Boolean).join(' · ') || null} />
          <Fact label="Delivery terms" value={o.deliveryTerms} />
          <Fact label="Payment terms" value={o.paymentTerms} />
          <Fact label="Acknowledged" value={o.acknowledgedAt ? `${day(o.acknowledgedAt)}${o.acknowledgedRef ? ` · ${o.acknowledgedRef}` : ''}` : null} />
          <Fact label="Rejected because" value={o.rejectedReason} />
          <Fact label="Cancelled because" value={o.cancelReason} />
          <Fact label="Buyer" value={o.buyer} />
          <Fact label="Notes" value={o.notes} />
        </View>
      </Card>
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Lines
          </Text>
          {o.lines.map((l) => (
            <View key={l.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]} testID={`order-line-${l.id}`}>
              <View style={styles.grow}>
                <Text>{`${l.lineNumber}. ${l.description}`}</Text>
                <Text variant="caption" tone="muted">
                  {[l.itemCode, `${quantity(l.receivedQty, l.unit)} of ${quantity(l.orderedQty, l.unit)} received`, l.outstandingQty > 0 ? `${quantity(l.outstandingQty, l.unit)} due` : null, typeof l.activity === 'string' ? l.activity : l.activity?.name].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text>{money(l.amount ?? (l.unitCost ?? 0) * l.orderedQty, o.currency)}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Deliveries
          </Text>
          {o.receipts.length === 0 ? <Text tone="muted">Nothing received yet.</Text> : null}
          {o.receipts.map((r) => (
            <View key={r.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]} testID={`order-receipt-${r.id}`}>
              <Text style={styles.grow}>{r.receiptNumber}</Text>
              <Text tone="muted">{[r.receivedAt ? day(r.receivedAt) : null, r.deliveryNote, typeof r.warehouse === 'string' ? r.warehouse : r.warehouse?.name].filter(Boolean).join(' · ')}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Card>
        <Evidence
          projectId={projectId!}
          recordType="procurement_order"
          recordId={o.id}
          recordRef={o.ref}
          canAdd={permissions.allows('procurement', 'update') || permissions.allows('procurement', 'create')}
          title="Delivery evidence"
          emptyText="No photographs of the load, its condition or the delivery note yet."
        />
      </Card>

      <Text variant="caption" tone="muted">
        Submitting, approving, issuing and closing an order happen on the web or through your approvals.
      </Text>
      <Button title="Open on the web" variant="secondary" onPress={() => void openOnWeb(webPathForTarget({ projectId, module: 'procurement', child: 'purchase-orders', recordType: 'purchase_order', recordId: o.id }))} testID="order-web" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  line: { paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
})
