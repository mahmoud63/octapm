import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useProjects } from '@/api/hooks'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, EmptyState, Text, spacing, useTheme } from '@/design-system'
import { discardItem, drainOutbox, retryItem, useOutbox, type OutboxItem } from '@/offline/outbox'
import { useOutboxStatus } from '@/offline/useOutboxStatus'
import { dateTime, humanise } from '@/utilities/format'

const KIND_LABELS: Record<string, string> = {
  'punch.create': 'Punch item',
  'form.create': 'Inspection',
  'daily-log.entry': 'Daily log entry',
  'timesheet.create': 'Timesheet',
  'attachment.upload': 'Photos',
  'goods-receipt': 'Goods receipt',
}

const tone = (status: OutboxItem['status']) => (status === 'sent' ? 'success' : status === 'attention' || status === 'refused' ? 'error' : status === 'sending' ? 'info' : 'warning') as 'success' | 'error' | 'info' | 'warning'

/**
 * What was captured without a signal and where it stands: waiting,
 * sending, sent, or needing the person. Nothing is dropped quietly; an
 * item that the server refused says why, and the person retries or
 * discards it.
 */
export default function OutboxScreen() {
  const theme = useTheme()
  const items = useOutbox((s) => s.items)
  const status = useOutboxStatus()
  const projects = useProjects()
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? null
  const groups = useMemo(() => {
    const order: OutboxItem['status'][] = ['attention', 'refused', 'sending', 'waiting', 'sent']
    return order.map((s) => ({ status: s, items: items.filter((i) => i.status === s).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) })).filter((g) => g.items.length)
  }, [items])

  return (
    <Screen title="Outbox" subtitle={status.offline ? 'Offline · items send when the signal returns' : status.locked ? 'Sign in again to send what is waiting' : status.waiting ? `${status.waiting} waiting` : 'Everything is sent'} contentStyle={styles.content} testID="screen-outbox">
      {items.length === 0 ? (
        <EmptyState title="Nothing is waiting to send" />
      ) : (
        <>
          {status.waiting > 0 && !status.offline && !status.locked ? <Button title="Send now" onPress={() => void drainOutbox('manual')} loading={status.draining} testID="outbox-send-now" /> : null}
          {groups.map((group) => (
            <Card key={group.status} edge={group.status === 'attention' || group.status === 'refused' ? theme.colors.error : undefined}>
              <View style={styles.stack}>
                <Text variant="label" label tone="muted">
                  {group.status === 'attention' ? 'Needs your attention' : group.status === 'refused' ? 'Refused by the server' : humanise(group.status)}
                </Text>
                {group.items.map((item) => (
                  <View key={item.id} style={[styles.item, { borderColor: theme.colors.border }]} testID={`outbox-item-${item.id}`}>
                    <View style={styles.row}>
                      <View style={styles.grow}>
                        <Text>{item.summary}</Text>
                        <Text variant="caption" tone="muted">
                          {[KIND_LABELS[item.kind] ?? item.kind, projectName(item.projectId), `Captured ${dateTime(item.createdAt)}`, item.sentAt ? `Sent ${dateTime(item.sentAt)}` : null, item.attempts > 1 ? `${item.attempts} attempts` : null].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Badge label={humanise(item.status)} tone={tone(item.status)} />
                    </View>
                    {item.error ? (
                      <Text variant="caption" tone={item.status === 'waiting' ? 'muted' : 'error'} testID={`outbox-error-${item.id}`}>
                        {item.status === 'waiting' ? `Last try: ${item.error.message}` : item.error.message}
                        {item.error.requestId ? ` (ref ${item.error.requestId.slice(0, 8)})` : ''}
                      </Text>
                    ) : null}
                    {item.status === 'attention' || item.status === 'refused' ? (
                      <View style={styles.actions}>
                        <Button title="Try again" variant="secondary" onPress={() => void retryItem(item.id)} testID={`outbox-retry-${item.id}`} />
                        <Button title="Discard" variant="danger" onPress={() => void discardItem(item.id)} testID={`outbox-discard-${item.id}`} />
                      </View>
                    ) : item.status === 'waiting' ? (
                      <View style={styles.actions}>
                        <Button title="Discard" variant="ghost" onPress={() => void discardItem(item.id)} testID={`outbox-discard-${item.id}`} />
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            </Card>
          ))}
          <Text variant="caption" tone="muted">
            Each item carries the key it was captured with, so sending it again after a lost reply counts once on the server. An item the server refused keeps what you captured until you discard it.
          </Text>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  item: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
