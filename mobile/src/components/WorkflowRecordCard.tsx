import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import type { AttachmentRef, WorkflowRecordBase } from '@/api/quality-types'
import { Button, Card, Text, spacing, useTheme } from '@/design-system'
import { openApiFile } from '@/files/open'
import { dateTime, day, humanise } from '@/utilities/format'

export function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <View style={styles.fact}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  )
}

const apiPath = (ref: AttachmentRef) => {
  const url = ref.fileUrl ?? ref.url ?? null
  if (!url) return null
  const i = url.indexOf('/api/v1')
  return i >= 0 ? url.slice(i + '/api/v1'.length) : url.startsWith('/') ? url : null
}

/**
 * The files behind a record, each openable through the platform viewer with
 * the bearer attached. Used wherever someone has to see the evidence before
 * they act on the record — a closeout, a change order under approval.
 */
export function EvidenceCard({ refs, onOpenFailed, empty = 'Nothing attached.', title = 'Evidence', testIDPrefix = 'evidence' }: { refs: AttachmentRef[]; onOpenFailed: (message: string) => void; empty?: string; title?: string; testIDPrefix?: string }) {
  const theme = useTheme()
  return (
    <Card testID={`${testIDPrefix}-card`}>
      <View style={styles.stack}>
        <Text variant="label" label tone="muted">
          {title}
        </Text>
        {refs.length === 0 ? (
          <Text tone="muted">{empty}</Text>
        ) : (
          refs.map((ref, index) => {
            const path = apiPath(ref)
            return (
              <View key={ref.id ?? `${index}`} style={[styles.row, { borderColor: theme.colors.border }]} testID={`${testIDPrefix}-${ref.id ?? index}`}>
                <Text style={styles.grow} numberOfLines={1}>
                  {ref.fileName ?? 'File'}
                </Text>
                {path ? <Button title="Open" variant="ghost" onPress={() => void openApiFile(path, ref.fileName ?? 'evidence').catch((e: unknown) => onOpenFailed(userMessage(e)))} /> : null}
              </View>
            )
          })
        )}
      </View>
    </Card>
  )
}

/** The closeout, evidence and history that NCRs and safety incidents share. */
export function WorkflowRecordCard({ record, onOpenFailed, showEvidence = true }: { record: WorkflowRecordBase; onOpenFailed: (message: string) => void; showEvidence?: boolean }) {
  const theme = useTheme()
  return (
    <>
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Closeout
          </Text>
          {record.closureComment ? <Text>{record.closureComment}</Text> : <Text tone="muted">Not submitted yet.</Text>}
          <Fact label="Submitted" value={record.closureSubmittedAt ? dateTime(record.closureSubmittedAt) : null} />
          <Fact label="Approved" value={record.closureApprovedAt ? dateTime(record.closureApprovedAt) : null} />
          <Fact label="Reopened" value={record.reopenedAt ? dateTime(record.reopenedAt) : null} />
        </View>
      </Card>
      {showEvidence ? <EvidenceCard refs={record.attachmentRefs} onOpenFailed={onOpenFailed} title="Closeout evidence" empty="No closeout evidence yet. It is added when the closeout is submitted." /> : null}
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            History
          </Text>
          {record.history.length === 0 ? (
            <Text tone="muted">No history yet.</Text>
          ) : (
            record.history.map((h) => (
              <View key={h.id} style={[styles.row, { borderColor: theme.colors.border }]}>
                <View style={styles.grow}>
                  <Text>
                    {humanise(h.action)}
                    {h.fromStatus || h.toStatus ? `: ${humanise(h.fromStatus) || '—'} → ${humanise(h.toStatus) || '—'}` : ''}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {[h.actorName, h.occurredAt ?? h.createdAt ? day(h.occurredAt ?? h.createdAt) : null, h.reason ?? h.comment].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  grow: { flex: 1 },
  fact: { gap: 2 },
})
