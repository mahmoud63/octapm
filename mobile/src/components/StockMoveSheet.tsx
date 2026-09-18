import { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isAppError, userMessage } from '@/api/errors'
import { useStockActions, useWarehouseLocations, useWarehouses } from '@/api/inventory-hooks'
import type { InventoryItem, StockMoveKind } from '@/api/inventory-types'
import { network } from '@/api/network'
import { useActivities } from '@/api/record-hooks'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'
import { humanise, quantity } from '@/utilities/format'

export const MOVE_TITLES: Record<StockMoveKind, string> = {
  issue: 'Issue to site',
  return: 'Return from site',
  reserve: 'Reserve or release',
  receive: 'Receive without an order',
  adjust: 'Adjust the count',
  damage: 'Write off damage',
  quarantine: 'Quarantine',
  release: 'Release from quarantine',
}

const decimal = /^\d+(\.\d+)?$/

/**
 * One stock movement, sent once. The server cannot tell a repeat from a
 * new movement, so nothing here is queued or retried: offline, the sheet
 * refuses; after a lost reply, it says so and points at the ledger.
 */
export function StockMoveSheet({ visible, kind, item, projectId, defaultWarehouseId, onCancel, onDone }: { visible: boolean; kind: StockMoveKind; item: InventoryItem; projectId: string | null; defaultWarehouseId: string | null; onCancel: () => void; onDone: (summary: string) => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const warehouses = useWarehouses(projectId)
  const [warehouseId, setWarehouseId] = useState<string | null>(defaultWarehouseId)
  const locations = useWarehouseLocations(warehouseId)
  const activities = useActivities(kind === 'issue' || kind === 'return' ? projectId : null)
  const actions = useStockActions(projectId)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [activityId, setActivityId] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [direction, setDirection] = useState<'add' | 'remove'>(kind === 'adjust' ? 'add' : 'add')
  const [unitCost, setUnitCost] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)

  useEffect(() => {
    if (visible) {
      setWarehouseId(defaultWarehouseId)
      setLocationId(null)
      setActivityId(null)
      setQty('')
      setDirection('add')
      setUnitCost('')
      setReference('')
      setNotes('')
      setFailure(null)
      setUncertain(false)
    }
  }, [visible, defaultWarehouseId, kind])

  const warehouseOptions = useMemo(() => (warehouses.data ?? []).filter((w) => w.status !== 'archived').map((w) => ({ id: w.id, label: w.name, sublabel: [w.code, humanise(w.kind)].filter(Boolean).join(' · ') })), [warehouses.data])
  const locationOptions = useMemo(() => (locations.data ?? []).map((l) => ({ id: l.id, label: l.name, sublabel: [l.code, humanise(l.kind)].filter(Boolean).join(' · ') })), [locations.data])
  const activityOptions = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])

  const needsActivity = kind === 'issue' || kind === 'return'
  const needsNotes = kind === 'adjust'
  const amount = decimal.test(qty) ? Number(qty) : NaN
  const ready = !!warehouseId && amount > 0 && (!needsActivity || !!activityId) && (!needsNotes || notes.trim().length > 0) && (!unitCost || decimal.test(unitCost))

  const submit = async () => {
    if (!warehouseId || !(amount > 0)) return
    setFailure(null)
    if (network.isKnownOffline()) {
      setFailure('You are offline. Stock movements are sent only while connected, and never queued.')
      return
    }
    const body = {
      itemId: item.id,
      warehouseId,
      locationId: locationId ?? undefined,
      quantity: kind === 'reserve' || kind === 'adjust' ? (direction === 'remove' ? -amount : amount) : amount,
      projectId: projectId ?? undefined,
      activityId: activityId ?? undefined,
      unitCost: kind === 'receive' && unitCost ? Number(unitCost) : undefined,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    }
    try {
      if (kind === 'reserve') {
        const state = await actions.reserve.mutateAsync(body)
        onDone(`${direction === 'remove' ? 'Released' : 'Reserved'} ${quantity(amount, item.unit)}. ${quantity(state.available, item.unit)} available.`)
      } else {
        await actions.move.mutateAsync({ kind, body })
        onDone(`${MOVE_TITLES[kind]}: ${quantity(amount, item.unit)} sent.`)
      }
    } catch (error) {
      if (isAppError(error) && error.retryable) {
        setUncertain(true)
        setFailure('The reply was lost. The movement may or may not have reached the server: check the recent movements before sending it again.')
      } else setFailure(userMessage(error))
    }
  }

  const busy = actions.move.isPending || actions.reserve.isPending

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="pageSheet">
      <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.md }]} testID="stock-move-sheet">
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text variant="title">{MOVE_TITLES[kind]}</Text>
            <Text variant="caption" tone="muted">
              {item.sku} · {item.name} · {quantity(item.available, item.unit)} available
            </Text>
          </View>
          <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <PickerField label="Warehouse" required options={warehouseOptions} value={warehouseId} onChange={(v) => { setWarehouseId(v as string | null); setLocationId(null) }} loading={warehouses.isPending} testID="move-warehouse" />
          {warehouseId && locationOptions.length ? <PickerField label="Bin or zone" options={locationOptions} value={locationId} onChange={(v) => setLocationId(v as string | null)} loading={locations.isPending} testID="move-location" /> : null}
          {kind === 'reserve' || kind === 'adjust' ? (
            <View style={styles.chips}>
              <FilterChip label={kind === 'reserve' ? 'Reserve' : 'Add'} selected={direction === 'add'} onPress={() => setDirection('add')} testID="move-direction-add" />
              <FilterChip label={kind === 'reserve' ? 'Release' : 'Remove'} selected={direction === 'remove'} onPress={() => setDirection('remove')} testID="move-direction-remove" />
            </View>
          ) : null}
          <Input label={`Quantity (${item.unit})`} required value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="0" error={qty && !(amount > 0) ? 'Enter a quantity above zero' : undefined} testID="move-quantity" />
          {needsActivity ? <PickerField label="Activity" required options={activityOptions} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} placeholder="Which work it goes to" testID="move-activity" /> : null}
          {kind === 'receive' ? <Input label="Unit cost" value={unitCost} onChangeText={setUnitCost} keyboardType="decimal-pad" placeholder="Moves the average cost" error={unitCost && !decimal.test(unitCost) ? 'Enter a number' : undefined} testID="move-unit-cost" /> : null}
          <Input label="Reference" value={reference} onChangeText={setReference} placeholder={kind === 'receive' ? 'Delivery note' : 'Requisition, ticket or note number'} testID="move-reference" />
          <Input label={needsNotes ? 'Reason' : 'Notes'} required={needsNotes} value={notes} onChangeText={setNotes} multiline testID="move-notes" />
          {failure ? (
            <Text variant="caption" tone="error" accessibilityRole="alert" testID="move-failure">
              {failure}
            </Text>
          ) : null}
          <Button title={uncertain ? 'Send again anyway' : 'Send'} variant={uncertain ? 'danger' : 'primary'} size="lg" fullWidth disabled={!ready} loading={busy} onPress={() => void submit()} testID="move-send" />
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingBottom: spacing.md },
  grow: { flex: 1 },
  body: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
