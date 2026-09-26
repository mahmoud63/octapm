import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { switchWorkspace } from '@/auth/session'
import { useAuthStore, workspaceLabel } from '@/auth/store'
import { Screen } from '@/components/Screen'
import { appRouteForRecord } from '@/navigation/links'
import { Badge, Button, Card, EmptyState, Text, spacing, useTheme } from '@/design-system'
import { discardItem, drainOutbox, inActiveWorkspace, retryItem, useOutbox, type OutboxItem } from '@/offline/outbox'
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

/** What the server created, so a sent item can be opened where it landed. */
const RECORD_TYPES: Record<string, string> = {
  'punch.create': 'punch_item',
  'form.create': 'form_instance',
  'timesheet.create': 'timesheet',
  'goods-receipt': 'inventory_item',
}

const tone = (status: OutboxItem['status']) => (status === 'sent' ? 'success' : status === 'attention' || status === 'refused' ? 'error' : status === 'sending' ? 'info' : 'warning') as 'success' | 'error' | 'info' | 'warning'

/**
 * What was captured without a signal and where it stands: waiting,
 * sending, sent, or needing the person. Nothing is dropped quietly; an
 * item that the server refused says why, and the person retries or
 * discards it.
 */
/** Where a sent item now lives, when the app has a screen for that record. */
const openable = (item: OutboxItem): string | null => {
  const recordType = RECORD_TYPES[item.kind]
  if (item.kind === 'attachment.upload') {
    const payload = item.payload as { recordType?: string }
    return item.resultId && payload.recordType ? appRouteForRecord(payload.recordType, item.resultId) : null
  }
  return recordType && item.resultId ? appRouteForRecord(recordType, item.resultId) : null
}

export default function OutboxScreen() {
  const theme = useTheme()
  const router = useRouter()
  const allItems = useOutbox((s) => s.items)
  const status = useOutboxStatus()
  const projects = useProjects()
  const memberships = useAuthStore((s) => s.memberships)
  const active = useAuthStore((s) => s.workspace)
  const switching = useAuthStore((s) => s.switching)
  const [switchFailure, setSwitchFailure] = useState<string | null>(null)
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? null
  // This workspace's items are the ones this session can send; another
  // workspace's wait here, under its name, until it is active again (§18).
  const items = useMemo(() => allItems.filter((i) => inActiveWorkspace(i, status.activeOrgId)), [allItems, status.activeOrgId])
  const elsewhere = useMemo(() => {
    const byWorkspace = new Map<string, OutboxItem[]>()
    for (const item of allItems) {
      if (inActiveWorkspace(item, status.activeOrgId) || item.status === 'sent') continue
      const key = item.orgId ?? ''
      byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), item])
    }
    return [...byWorkspace.entries()].map(([orgId, held]) => ({ orgId, membership: memberships.find((m) => m.orgId === orgId) ?? null, items: held.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }))
  }, [allItems, memberships, status.activeOrgId])
  const groups = useMemo(() => {
    const order: OutboxItem['status'][] = ['attention', 'refused', 'sending', 'waiting', 'sent']
    return order.map((s) => ({ status: s, items: items.filter((i) => i.status === s).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) })).filter((g) => g.items.length)
  }, [items])

  const goTo = async (orgId: string) => {
    setSwitchFailure(null)
    try {
      await switchWorkspace(orgId)
      // The queue of that workspace drains as it is adopted; the screen stays on the outbox to show it.
    } catch (error) {
      setSwitchFailure(userMessage(error))
    }
  }

  return (
    <Screen title="Outbox" subtitle={status.offline ? 'Offline · items send when the signal returns' : status.locked ? 'Sign in again to send what is waiting' : status.waiting ? `${status.waiting} waiting` : 'Everything is sent'} contentStyle={styles.content} testID="screen-outbox">
      {items.length === 0 && elsewhere.length === 0 ? (
        <EmptyState title="Nothing is waiting to send" />
      ) : (
        <>
          {items.length === 0 ? <EmptyState title={`Nothing is waiting to send from ${workspaceLabel(active)}`} /> : null}
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
                    {item.status === 'sent' ? (
                      <View style={styles.row}>
                        <Text variant="caption" tone="success" style={styles.grow} testID={`outbox-result-${item.id}`}>
                          {item.resultRef ? `The office has this as ${item.resultRef}.` : 'The office has this.'}
                        </Text>
                        {openable(item) ? <Button title="Open record" variant="ghost" onPress={() => router.push(openable(item) as never)} testID={`outbox-open-${item.id}`} /> : null}
                      </View>
                    ) : null}
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
          {elsewhere.map((group) => (
            <Card key={group.orgId || 'unknown'} testID={`outbox-elsewhere-${group.orgId}`}>
              <View style={styles.stack}>
                <Text variant="label" label tone="muted">
                  Waiting in {workspaceLabel(group.membership)}
                </Text>
                <Text variant="caption" tone="muted">
                  {group.items.length} item{group.items.length === 1 ? '' : 's'} captured in {workspaceLabel(group.membership)}. They are sent only from that workspace, never from {workspaceLabel(active)}.
                </Text>
                {group.items.map((item) => (
                  <View key={item.id} style={[styles.item, { borderColor: theme.colors.border }]} testID={`outbox-item-${item.id}`}>
                    <View style={styles.row}>
                      <View style={styles.grow}>
                        <Text>{item.summary}</Text>
                        <Text variant="caption" tone="muted">
                          {[KIND_LABELS[item.kind] ?? item.kind, `Captured ${dateTime(item.createdAt)}`].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Badge label="Held" tone="warning" />
                    </View>
                  </View>
                ))}
                {group.membership && group.membership.status === 'active' ? (
                  <Button title={`Switch to ${workspaceLabel(group.membership)} to send`} variant="secondary" loading={switching} onPress={() => void goTo(group.orgId)} testID={`outbox-switch-${group.orgId}`} />
                ) : (
                  <Text variant="caption" tone="muted">
                    You no longer have access to that workspace on this account; the items stay on this device.
                  </Text>
                )}
              </View>
            </Card>
          ))}
          {switchFailure ? (
            <Text tone="error" accessibilityRole="alert">
              {switchFailure}
            </Text>
          ) : null}
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
