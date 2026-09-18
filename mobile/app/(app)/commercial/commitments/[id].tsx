import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useCommitment } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { openOnWeb } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money, percent } from '@/utilities/format'

/** One commitment: who holds it, what it is worth now, its lines and its change orders. Read only. */
export default function CommitmentScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const commitment = useCommitment(projectId, id ?? null)

  if (!projectId || !id) {
    return (
      <Screen testID="screen-commitment">
        <ErrorState message="Choose a project to open this commitment." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (commitment.isPending) {
    return (
      <Screen testID="screen-commitment">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (commitment.isError) {
    return (
      <Screen testID="screen-commitment">
        <ErrorState message={userMessage(commitment.error)} onRetry={() => void commitment.refetch()} />
      </Screen>
    )
  }

  const c = commitment.data
  return (
    <Screen contentStyle={styles.content} testID="screen-commitment">
      <RecordHeader reference={c.ref} title={c.title} status={c.status} meta={[humanise(c.type), c.vendor?.name ?? c.supplier, c.startDate ? `${day(c.startDate)} – ${c.endDate ? day(c.endDate) : '…'}` : null].filter((v): v is string => !!v)} testID="commitment-header" />
      {c.ballInCourt.label ? (
        <View style={styles.row}>
          <Text variant="label" label tone="muted">
            Ball in court
          </Text>
          <Badge label={c.ballInCourt.label} tone={c.ballInCourt.isYou ? 'warning' : 'info'} />
        </View>
      ) : null}
      <View style={styles.kpis}>
        <KPI label="Original" value={money(c.original, c.currency)} />
        <KPI label="Approved changes" value={money(c.approvedChanges, c.currency)} />
        <KPI label="Pending changes" value={money(c.pendingChanges, c.currency)} tone={c.pendingChanges ? 'warning' : 'default'} />
        <KPI label="Revised" value={money(c.revised, c.currency)} />
        <KPI label="Drawn down" value={money(c.drawnDown, c.currency)} qualifier={c.revised ? percent((c.drawnDown / c.revised) * 100) : undefined} />
        <KPI label="Retention" value={c.retentionRate != null ? percent(c.retentionRate) : '—'} />
      </View>
      <Card>
        <View style={styles.stack}>
          {c.description ? <Text>{c.description}</Text> : null}
          <Fact label="Vendor contact" value={[c.vendor?.contactName, c.vendor?.phone, c.vendor?.email].filter(Boolean).join(' · ') || null} />
          <Fact label="Payment terms" value={c.paymentTerms} />
          <Fact label="Insurance" value={c.insuranceReady ? 'In place' : 'Not yet in place'} />
          <Fact label="Executed" value={c.executedAt ? day(c.executedAt) : null} />
          <Fact label="Notes" value={c.notes} />
          <Fact label="Voided because" value={c.voidReason} />
        </View>
      </Card>
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Schedule of values
          </Text>
          {c.lines.length === 0 ? <Text tone="muted">No lines.</Text> : null}
          {c.lines.map((l) => (
            <View key={l.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]} testID={`commitment-line-${l.id}`}>
              <View style={styles.grow}>
                <Text>{`${l.lineNumber}. ${l.description}`}</Text>
                <Text variant="caption" tone="muted">
                  {[l.costCode?.code, l.boqItem?.code, l.activity?.name].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text>{money(l.amount, c.currency)}</Text>
            </View>
          ))}
        </View>
      </Card>
      {c.changeOrders.length ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Commitment change orders
            </Text>
            {c.changeOrders.map((co) => (
              <View key={co.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]} testID={`commitment-co-${co.id}`}>
                <Text style={styles.grow}>{[co.ref, co.title].filter(Boolean).join(' · ')}</Text>
                <Badge label={humanise(co.status)} tone={co.status === 'approved' ? 'success' : co.status === 'rejected' ? 'error' : 'info'} />
                <Text>{money(co.value, c.currency)}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Text variant="caption" tone="muted">
        Submitting, approving, executing and closing a commitment happen on the web or through your approvals.
      </Text>
      <Button title="Open on the web" variant="secondary" onPress={() => void openOnWeb(c.path)} testID="commitment-web" />
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
