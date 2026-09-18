import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useInventoryItems, useTransferActions, useWarehouses } from '@/api/inventory-hooks'
import { network } from '@/api/network'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing, useTheme } from '@/design-system'
import { useRememberedWarehouse } from '@/inventory/preferences'
import { useProjectStore } from '@/projects/store'
import { humanise, quantity } from '@/utilities/format'

const decimal = /^\d+(\.\d+)?$/
type Line = { key: number; itemId: string | null; qty: string }

/** A draft transfer: from where, to where, which items and how much. Dispatch is a separate step on the record. */
export default function NewTransferScreen() {
  const theme = useTheme()
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const warehouses = useWarehouses(projectId)
  const items = useInventoryItems(projectId)
  const remembered = useRememberedWarehouse(projectId)
  const actions = useTransferActions(projectId)
  const [fromId, setFromId] = useState<string | null>(remembered.warehouseId)
  const [toId, setToId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: 1, itemId: null, qty: '' }])
  const [failure, setFailure] = useState<string | null>(null)

  const warehouseOptions = useMemo(() => (warehouses.data ?? []).filter((w) => w.status !== 'archived').map((w) => ({ id: w.id, label: w.name, sublabel: [w.code, humanise(w.kind)].filter(Boolean).join(' · ') })), [warehouses.data])
  const itemOptions = useMemo(() => (items.data ?? []).filter((i) => i.status !== 'archived').map((i) => ({ id: i.id, label: i.name, sublabel: `${i.sku} · ${quantity(i.available, i.unit)} available` })), [items.data])
  const complete = lines.filter((l) => l.itemId && decimal.test(l.qty) && Number(l.qty) > 0)
  const ready = !!fromId && !!toId && fromId !== toId && complete.length > 0 && complete.length === lines.filter((l) => l.itemId || l.qty).length

  const save = async () => {
    if (!fromId || !toId) return
    setFailure(null)
    if (network.isKnownOffline()) {
      setFailure('You are offline. Transfers are sent only while connected; nothing is queued.')
      return
    }
    try {
      const created = await actions.create.mutateAsync({ fromWarehouseId: fromId, toWarehouseId: toId, reason: reason.trim() || undefined, lines: complete.map((l) => ({ itemId: l.itemId!, quantity: Number(l.qty) })) })
      router.replace(`/inventory/transfers/${created.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-transfer-new">
      <Card>
        <View style={styles.stack}>
          <PickerField label="From" required options={warehouseOptions} value={fromId} onChange={(v) => setFromId(v as string | null)} loading={warehouses.isPending} testID="transfer-from" />
          <PickerField label="To" required options={warehouseOptions.filter((w) => w.id !== fromId)} value={toId} onChange={(v) => setToId(v as string | null)} loading={warehouses.isPending} testID="transfer-to" />
          <Input label="Reason" value={reason} onChangeText={setReason} placeholder="Why the stock moves" testID="transfer-reason" />
        </View>
      </Card>
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Lines
          </Text>
          {lines.map((line, index) => (
            <View key={line.key} style={[styles.line, { borderColor: theme.colors.border }]} testID={`transfer-line-${index}`}>
              <PickerField label={`Item ${index + 1}`} required options={itemOptions} value={line.itemId} onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, itemId: v as string | null } : l)))} loading={items.isPending} testID={`transfer-item-${index}`} />
              <View style={styles.row}>
                <View style={styles.grow}>
                  <Input label="Quantity" required value={line.qty} onChangeText={(t) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, qty: t } : l)))} keyboardType="decimal-pad" error={line.qty && !(decimal.test(line.qty) && Number(line.qty) > 0) ? 'Above zero' : undefined} testID={`transfer-qty-${index}`} />
                </View>
                {lines.length > 1 ? <Button title="Remove" variant="ghost" onPress={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} testID={`transfer-remove-${index}`} /> : null}
              </View>
            </View>
          ))}
          <Button title="Add a line" variant="secondary" onPress={() => setLines((prev) => [...prev, { key: (prev.at(-1)?.key ?? 0) + 1, itemId: null, qty: '' }])} testID="transfer-add-line" />
        </View>
      </Card>
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="transfer-failure">
          {failure}
        </Text>
      ) : null}
      <Button title="Create draft transfer" size="lg" fullWidth disabled={!ready} loading={actions.create.isPending} onPress={() => void save()} testID="transfer-create" />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  grow: { flex: 1 },
  line: { gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
})
