import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useGoodsReceipt, usePurchaseOrder, useWarehouseLocations, useWarehouses } from '@/api/inventory-hooks'
import { RECEIVABLE_PO_STATUSES, type GoodsReceiptResult, type PoLine } from '@/api/inventory-types'
import { PickerField } from '@/components/PickerField'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, ErrorState, Input, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { useRememberedWarehouse } from '@/inventory/preferences'
import { captureOrQueue } from '@/offline/capture'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money, quantity } from '@/utilities/format'
import { newId } from '@/utilities/id'

const decimal = /^\d+(\.\d+)?$/
const receivable = new Set<string>(RECEIVABLE_PO_STATUSES)

/** A receipt number made once per delivery on this device: the server's natural key, reused on every retry. */
export const receiptNumberFor = (id: string) => `GRN-M-${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`

type LineEntry = { accepted: string; rejected: string; locationId: string | null }

/**
 * One purchase order and the delivery against it. Every outstanding line is
 * pre-filled with what is still due; the storekeeper corrects the figures
 * from the delivery note and posts. The receipt number is generated once,
 * so a retry after a lost reply counts once on the server.
 */
export default function ReceiveScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const order = usePurchaseOrder(id ?? null)
  const warehouses = useWarehouses(projectId)
  const remembered = useRememberedWarehouse(projectId)
  const receipt = useGoodsReceipt(projectId)
  const [receiving, setReceiving] = useState(false)
  const [receiptNumber] = useState(() => receiptNumberFor(newId()))
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const locations = useWarehouseLocations(warehouseId)
  const [deliveryNote, setDeliveryNote] = useState('')
  const [notes, setNotes] = useState('')
  const [entries, setEntries] = useState<Record<string, LineEntry>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [posted, setPosted] = useState<GoodsReceiptResult | null>(null)
  const [queued, setQueued] = useState(false)

  useEffect(() => {
    if (!warehouseId && remembered.warehouseId) setWarehouseId(remembered.warehouseId)
  }, [remembered.warehouseId, warehouseId])

  const lines = useMemo(() => order.data?.lines ?? [], [order.data])
  const outstanding = useMemo(() => lines.filter((l) => l.outstandingQty > 0), [lines])
  const warehouseOptions = useMemo(() => (warehouses.data ?? []).filter((w) => w.status !== 'archived').map((w) => ({ id: w.id, label: w.name, sublabel: [w.code, humanise(w.kind)].filter(Boolean).join(' · ') })), [warehouses.data])
  const locationOptions = useMemo(() => (locations.data ?? []).map((l) => ({ id: l.id, label: l.name, sublabel: [l.code, humanise(l.kind)].filter(Boolean).join(' · ') })), [locations.data])

  const start = () => {
    const initial: Record<string, LineEntry> = {}
    for (const l of outstanding) initial[l.id] = { accepted: String(l.outstandingQty), rejected: '', locationId: null }
    setEntries(initial)
    setFailure(null)
    setReceiving(true)
  }

  const entry = (line: PoLine): LineEntry => entries[line.id] ?? { accepted: '', rejected: '', locationId: null }
  const setEntry = (line: PoLine, patch: Partial<LineEntry>) => setEntries((prev) => ({ ...prev, [line.id]: { ...entry(line), ...patch } }))
  const numeric = (s: string) => (s.trim() === '' ? 0 : decimal.test(s.trim()) ? Number(s) : NaN)
  const problems = outstanding.map((l) => {
    const e = entry(l)
    const a = numeric(e.accepted)
    const r = numeric(e.rejected)
    if (Number.isNaN(a) || Number.isNaN(r)) return `${l.description}: enter numbers`
    if (a + r > l.outstandingQty) return `${l.description}: ${quantity(a + r, l.unit)} is more than the ${quantity(l.outstandingQty, l.unit)} still due`
    return null
  })
  const anyQuantity = outstanding.some((l) => numeric(entry(l).accepted) > 0 || numeric(entry(l).rejected) > 0)
  const ready = !!warehouseId && anyQuantity && problems.every((p) => p === null)

  const post = async () => {
    if (!order.data || !warehouseId) return
    setFailure(null)
    try {
      const body = {
        orderId: order.data.id,
        warehouseId,
        receiptNumber,
        deliveryNote: deliveryNote.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: outstanding
          .map((l) => ({ poLineId: l.id, acceptedQty: numeric(entry(l).accepted) || undefined, rejectedQty: numeric(entry(l).rejected) || undefined, locationId: entry(l).locationId ?? undefined }))
          .filter((l) => (l.acceptedQty ?? 0) > 0 || (l.rejectedQty ?? 0) > 0),
      }
      // The receipt number is a natural key on the server, so this is the one stock write that may wait in the outbox.
      const outcome = await captureOrQueue({ projectId: projectId ?? order.data.projectId, kind: 'goods-receipt', summary: `Delivery ${receiptNumber} against ${order.data.ref}`, payload: { body }, clientRequestId: receiptNumber }, () => receipt.mutateAsync(body))
      if (outcome.queued) setQueued(true)
      else setPosted(outcome.sent)
      setReceiving(false)
      if (warehouseId !== remembered.warehouseId) void remembered.remember(warehouseId)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!id) {
    return (
      <Screen testID="screen-receive">
        <ErrorState message="No purchase order was chosen." onRetry={() => router.replace('/inventory/receive')} />
      </Screen>
    )
  }
  if (order.isPending) {
    return (
      <Screen testID="screen-receive">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (order.isError) {
    return (
      <Screen testID="screen-receive">
        <ErrorState message={userMessage(order.error)} onRetry={() => void order.refetch()} />
      </Screen>
    )
  }

  const po = order.data
  const canReceive = permissions.allowsTransition('inventory', 'stock.receive') && receivable.has(po.status) && outstanding.length > 0

  return (
    <Screen contentStyle={styles.content} testID="screen-receive">
      <RecordHeader reference={po.ref} title={po.supplier ?? 'Purchase order'} status={po.status} meta={[po.value != null ? money(po.value, po.currency) : null, po.orderDate ? `Ordered ${day(po.orderDate)}` : null, po.promisedDate ? `Promised ${day(po.promisedDate)}` : null, `Warehouse: ${humanise(po.warehouseStatus)}`].filter((v): v is string => !!v)} testID="po-header" />

      {queued ? (
        <Card edge={theme.colors.warning} testID="receipt-queued">
          <View style={styles.stack}>
            <Text variant="heading">Kept in the outbox</Text>
            <Text>{`Receipt ${receiptNumber} will post when the signal returns. Its number is fixed, so it counts once however many times it is sent.`}</Text>
            <Button title="Open the outbox" variant="secondary" onPress={() => router.push('/outbox')} testID="receipt-open-outbox" />
          </View>
        </Card>
      ) : null}
      {posted ? (
        <Card edge={theme.colors.success} testID="receipt-posted">
          <View style={styles.stack}>
            <Text variant="heading">{posted.replayed ? 'Already received' : 'Received'}</Text>
            <Text>{posted.replayed ? `The server already held receipt ${posted.receiptNumber}; the earlier post counted and nothing was added twice.` : `Receipt ${posted.receiptNumber} is posted.`}</Text>
            {posted.order.status ? <Text tone="muted">{`Order now ${humanise(posted.order.status)}${posted.order.fullyReceived ? ' · fully received' : ''}`}</Text> : null}
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Lines
          </Text>
          {lines.map((l) => {
            const e = entry(l)
            const editable = receiving && l.outstandingQty > 0
            return (
              <View key={l.id} style={[styles.line, { borderColor: theme.colors.border }]} testID={`po-line-${l.id}`}>
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <Text>{`${l.lineNumber}. ${l.description}`}</Text>
                    <Text variant="caption" tone="muted">
                      {[l.itemCode, `${quantity(l.receivedQty, l.unit)} of ${quantity(l.orderedQty, l.unit)} received`, l.rejectedQty ? `${quantity(l.rejectedQty, l.unit)} rejected` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Badge label={l.outstandingQty > 0 ? `${quantity(l.outstandingQty, l.unit)} due` : 'Complete'} tone={l.outstandingQty > 0 ? 'info' : 'success'} />
                </View>
                {editable ? (
                  <View style={styles.entry}>
                    <View style={styles.grow}>
                      <Input label={`Accepted (${l.unit ?? 'qty'})`} value={e.accepted} onChangeText={(t) => setEntry(l, { accepted: t })} keyboardType="decimal-pad" testID={`receipt-accepted-${l.id}`} />
                    </View>
                    <View style={styles.grow}>
                      <Input label="Rejected" value={e.rejected} onChangeText={(t) => setEntry(l, { rejected: t })} keyboardType="decimal-pad" placeholder="0" testID={`receipt-rejected-${l.id}`} />
                    </View>
                  </View>
                ) : null}
                {editable && locationOptions.length ? <PickerField label="Put away in" options={locationOptions} value={e.locationId} onChange={(v) => setEntry(l, { locationId: v as string | null })} loading={locations.isPending} testID={`receipt-location-${l.id}`} /> : null}
              </View>
            )
          })}
        </View>
      </Card>

      {receiving ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Delivery
            </Text>
            <PickerField label="Into warehouse" required options={warehouseOptions} value={warehouseId} onChange={(v) => setWarehouseId(v as string | null)} loading={warehouses.isPending} testID="receipt-warehouse" />
            <Input label="Delivery note" value={deliveryNote} onChangeText={setDeliveryNote} placeholder="Supplier's note or ticket number" testID="receipt-delivery-note" />
            <Input label="Notes" value={notes} onChangeText={setNotes} multiline testID="receipt-notes" />
            <Text variant="caption" tone="muted" testID="receipt-number">
              Receipt {receiptNumber}
            </Text>
            {problems.filter(Boolean).map((p) => (
              <Text key={p} variant="caption" tone="error">
                {p}
              </Text>
            ))}
            {failure ? (
              <Text tone="error" accessibilityRole="alert" testID="receipt-failure">
                {failure}
              </Text>
            ) : null}
            <Button title="Post receipt" size="lg" fullWidth disabled={!ready} loading={receipt.isPending} onPress={() => void post()} testID="receipt-post" />
            <Button title="Cancel" variant="ghost" onPress={() => setReceiving(false)} disabled={receipt.isPending} />
          </View>
        </Card>
      ) : canReceive && !posted && !queued ? (
        <Button title="Receive delivery" size="lg" fullWidth onPress={start} testID="receipt-start" />
      ) : !receivable.has(po.status) ? (
        <Text tone="muted">This order is {humanise(po.status)}; nothing can be received against it.</Text>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entry: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  line: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
})
