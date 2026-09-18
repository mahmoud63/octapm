import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useHistory } from '@/api/record-hooks'
import type { AuditEvent } from '@/api/record-types'
import { ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { dateTime, humanise } from '@/utilities/format'

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  status_changed: 'Status changed',
  submitted: 'Submitted',
  answered: 'Answered',
  approved: 'Approved',
  rejected: 'Rejected',
  closed: 'Closed',
  reopened: 'Reopened',
  commented: 'Commented',
  assigned: 'Assigned',
  attachment_added: 'Attachment added',
}

export function describeEvent(event: AuditEvent): string {
  const label = ACTION_LABELS[event.action] ?? humanise(event.action)
  if (event.fromStatus || event.toStatus) return `${label}: ${humanise(event.fromStatus) || '—'} → ${humanise(event.toStatus) || '—'}`
  if (event.decision) return `${label} (${humanise(event.decision)})`
  return label
}

/**
 * What happened to a record, in order, from the server's audit trail. The
 * app never reconstructs history from its own cache.
 */
export function History({ projectId, entityType, entityId }: { projectId: string; entityType: string; entityId: string }) {
  const theme = useTheme()
  const history = useHistory(projectId, entityType, entityId)
  return (
    <View style={styles.wrap} testID="history">
      <Text variant="label" label tone="muted">
        History
      </Text>
      {history.isPending ? (
        <SkeletonList rows={2} />
      ) : history.isError ? (
        <ErrorState message={userMessage(history.error)} onRetry={() => void history.refetch()} />
      ) : history.data.length === 0 ? (
        <Text tone="muted">No history yet.</Text>
      ) : (
        history.data.map((event) => (
          <View key={event.id} style={[styles.event, { borderColor: theme.colors.border }]} testID={`history-${event.id}`}>
            <View style={[styles.dot, { backgroundColor: theme.colors.brand }]} />
            <View style={styles.body}>
              <Text>{describeEvent(event)}</Text>
              <Text variant="caption" tone="muted">
                {event.actorName ?? 'System'}
                {event.actorRole ? ` · ${humanise(event.actorRole)}` : ''} · {dateTime(event.occurredAt)}
              </Text>
              {event.reason || event.comment ? (
                <Text variant="caption" numberOfLines={4}>
                  {event.reason ?? event.comment}
                </Text>
              ) : null}
            </View>
          </View>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  event: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  body: { flex: 1, gap: 2 },
})
