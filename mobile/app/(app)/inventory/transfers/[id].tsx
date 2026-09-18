import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useTransferActions, useTransfers } from '@/api/inventory-hooks'
import { network } from '@/api/network'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Button, Card, ErrorState, Input, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { dateTime, quantity } from '@/utilities/format'

const decimal = /^\d+(\.\d+)?$/

/** One transfer, from the list since the server has no single-transfer route: dispatch it, or receive it line by line. */
export default function TransferScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const transfers = useTransfers()
  const actions = useTransferActions(projectId)
  const [receiving, setReceiving] = useState(false)
  const [entries, setEntries] = useState<Record<string, { received: string; damaged: string }>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const record = useMemo(() => transfers.data?.find((t) => t.id === id) ?? null, [transfers.data, id])

  if (!id) {
    return (
      <Screen testID="screen-transfer">
        <ErrorState message="No transfer was chosen." onRetry={() => router.replace('/inventory/transfers')} />
      </Screen>
    )
  }
  if (transfers.isPending) {
    return (
      <Screen testID="screen-transfer">
        <SkeletonList rows={5} />
      </Screen>
    )
  }
  if (transfers.isError || !record) {
    return (
      <Screen testID="screen-transfer">
        <ErrorState message={transfers.isError ? userMessage(transfers.error) : 'This transfer is no longer available.'} onRetry={() => void transfers.refetch()} />
      </Screen>
    )
  }

  const may = permissions.allowsTransition('inventory', 'stock.transfer')
  const offline = () => {
    if (!network.isKnownOffline()) return false
    setFailure('You are offline. Transfers are sent only while connected; nothing is queued.')
    return true
  }
  const dispatch = async () => {
    setFailure(null)
    if (offline()) return
    try {
      await actions.dispatch.mutateAsync(record.id)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }
  const startReceive = () => {
    const initial: Record<string, { received: string; damaged: string }> = {}
    for (const l of record.lines) initial[l.id] = { received: String(l.quantity), damaged: '' }
    setEntries(initial)
    setFailure(null)
    setReceiving(true)
  }
  const numeric = (s: string) => (s.trim() === '' ? 0 : decimal.test(s.trim()) ? Number(s) : NaN)
  const problems = record.lines.map((l) => {
    const e = entries[l.id] ?? { received: '', damaged: '' }
    const r = numeric(e.received)
    const d = numeric(e.damaged)
    if (Number.isNaN(r) || Number.isNaN(d)) return `${l.name ?? l.sku}: enter numbers`
    if (r + d > l.quantity) return `${l.name ?? l.sku}: ${quantity(r + d, l.unit)} is more than the ${quantity(l.quantity, l.unit)} sent`
    return null
  })
  const receive = async () => {
    setFailure(null)
    if (offline()) return
    try {
      await actions.receive.mutateAsync({ transferId: record.id, lines: record.lines.map((l) => ({ id: l.id, receivedQty: numeric(entries[l.id]?.received ?? ''), damagedQty: numeric(entries[l.id]?.damaged ?? '') || undefined })) })
      setReceiving(false)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (record.status === 'draft' && may) bar.push({ id: 'dispatch', title: 'Dispatch', variant: 'primary', busy: actions.dispatch.isPending, onPress: () => void dispatch() })
  if (record.status === 'in_transit' && may && !receiving) bar.push({ id: 'receive', title: 'Receive', variant: 'primary', onPress: startReceive })

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-transfer">
        <RecordHeader reference={record.ref} title={`${record.fromWarehouse ?? 'From'} → ${record.toWarehouse ?? 'To'}`} status={record.status} meta={[record.dispatchedAt ? `Dispatched ${dateTime(record.dispatchedAt)}` : null, record.receivedAt ? `Received ${dateTime(record.receivedAt)}` : null].filter((v): v is string => !!v)} testID="transfer-header" />
        <Card>
          <View style={styles.stack}>
            <Fact label="Reason" value={record.reason} />
            <Fact label="Notes" value={record.notes} />
          </View>
        </Card>
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Lines
            </Text>
            {record.lines.length === 0 ? <Text tone="muted">No lines.</Text> : null}
            {record.lines.map((l) => {
              const e = entries[l.id] ?? { received: '', damaged: '' }
              return (
                <View key={l.id} style={[styles.line, { borderColor: theme.colors.border }]} testID={`transfer-line-${l.id}`}>
                  <View style={styles.row}>
                    <Text style={styles.grow}>{l.name ?? l.sku ?? 'Item'}</Text>
                    <Text tone="muted">{record.status === 'received' ? `${quantity(l.receivedQty ?? 0, l.unit)} of ${quantity(l.quantity, l.unit)}${l.damagedQty ? ` · ${quantity(l.damagedQty, l.unit)} damaged` : ''}` : quantity(l.quantity, l.unit)}</Text>
                  </View>
                  {receiving ? (
                    <View style={styles.row}>
                      <View style={styles.grow}>
                        <Input label="Received" value={e.received} onChangeText={(t) => setEntries((prev) => ({ ...prev, [l.id]: { ...e, received: t } }))} keyboardType="decimal-pad" testID={`transfer-received-${l.id}`} />
                      </View>
                      <View style={styles.grow}>
                        <Input label="Damaged" value={e.damaged} onChangeText={(t) => setEntries((prev) => ({ ...prev, [l.id]: { ...e, damaged: t } }))} keyboardType="decimal-pad" placeholder="0" testID={`transfer-damaged-${l.id}`} />
                      </View>
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        </Card>
        {receiving ? (
          <Card>
            <View style={styles.stack}>
              {problems.filter(Boolean).map((p) => (
                <Text key={p} variant="caption" tone="error">
                  {p}
                </Text>
              ))}
              <Button title="Confirm receipt" size="lg" fullWidth disabled={problems.some(Boolean)} loading={actions.receive.isPending} onPress={() => void receive()} testID="transfer-receive-confirm" />
              <Button title="Cancel" variant="ghost" onPress={() => setReceiving(false)} disabled={actions.receive.isPending} />
            </View>
          </Card>
        ) : null}
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="transfer-failure">
            {failure}
          </Text>
        ) : null}
      </Screen>
      <ActionBar actions={bar} />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  line: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
})
