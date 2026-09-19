import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useChangeOrders } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import type { AttachmentRef } from '@/api/quality-types'
import { Comments } from '@/components/Comments'
import { History } from '@/components/History'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { EvidenceCard, Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, KPI, SkeletonList, Text, spacing } from '@/design-system'
import { openOnWeb, webPathForTarget } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money } from '@/utilities/format'

/** One change order, from the list since the server has no single-record route; read only on the phone. */
export default function ChangeOrderScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const orders = useChangeOrders(projectId)
  const currency = projects.data?.find((p) => p.id === projectId)?.currency
  const record = useMemo(() => orders.data?.find((o) => o.id === id) ?? null, [orders.data, id])
  const [openFailure, setOpenFailure] = useState<string | null>(null)

  if (!projectId || !id) {
    return (
      <Screen testID="screen-change-order">
        <ErrorState message="Choose a project to open this change order." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (orders.isPending) {
    return (
      <Screen testID="screen-change-order">
        <SkeletonList rows={5} />
      </Screen>
    )
  }
  if (orders.isError || !record) {
    return (
      <Screen testID="screen-change-order">
        <ErrorState message={orders.isError ? userMessage(orders.error) : 'This change order is no longer available.'} onRetry={() => void orders.refetch()} />
      </Screen>
    )
  }

  const o = record
  return (
    <Screen contentStyle={styles.content} testID="screen-change-order">
      <RecordHeader reference={o.ref} title={o.description} status={o.status} meta={[o.category ? humanise(o.category) : null, o.submittedDate ? `Submitted ${day(o.submittedDate)}` : null, o.approvedAt ? `Approved ${day(o.approvedAt)}` : null].filter((v): v is string => !!v)} testID="change-order-header" />
      {o.ballInCourt?.label ? (
        <View style={styles.row}>
          <Text variant="label" label tone="muted">
            Ball in court
          </Text>
          <Badge label={o.ballInCourt.label} tone={o.ballInCourt.isYou ? 'warning' : 'info'} />
        </View>
      ) : null}
      <View style={styles.kpis}>
        <KPI label="Value" value={money(o.value, currency)} />
        <KPI label="Schedule impact" value={o.scheduleImpact != null ? `${o.scheduleImpact} d` : '—'} tone={o.scheduleImpact ? 'warning' : 'default'} />
      </View>
      <Card>
        <View style={styles.stack}>
          <Fact label="Schedule impact" value={o.scheduleImpactSummary} />
          <Fact label="Cost impact" value={o.costImpactSummary} />
          <Fact label="Activities" value={(o.activityLinks ?? []).map((l) => l.activity?.name).filter(Boolean).join(', ') || o.activity?.name || null} />
          <Fact label="Raised by" value={o.raisedBy} />
          <Fact label="Approval comment" value={o.approvalComment ?? null} />
          <Fact label="Rejected because" value={o.rejectedReason} />
        </View>
      </Card>
      <EvidenceCard refs={(o.attachmentRefs ?? []) as AttachmentRef[]} onOpenFailed={setOpenFailure} empty="Nothing attached to this change order." testIDPrefix="change-order-evidence" />
      {openFailure ? (
        <Text tone="error" accessibilityRole="alert" testID="change-order-open-failure">
          {openFailure}
        </Text>
      ) : null}
      <Card>
        <Comments projectId={projectId} recordType="change_order" recordId={o.id} />
      </Card>
      <Card>
        <History projectId={projectId} entityType="change_order" entityId={o.id} />
      </Card>
      <Text variant="caption" tone="muted">
        Submitting, approving and rejecting a change order happen on the web or through your approvals.
      </Text>
      <Button title="Open on the web" variant="secondary" onPress={() => void openOnWeb(o.path ?? webPathForTarget({ projectId, module: 'commercial', child: 'change-orders', recordType: 'change_order', recordId: o.id }))} testID="change-order-web" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
})
