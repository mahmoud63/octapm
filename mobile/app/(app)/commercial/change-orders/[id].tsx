import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useChangeOrders } from '@/api/commercial-hooks'
import type { ChangeOrderRelatedRecords } from '@/api/commercial-types'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import type { AttachmentRef } from '@/api/quality-types'
import { Comments } from '@/components/Comments'
import { History } from '@/components/History'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { EvidenceCard, Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
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
          {o.relatedRecords ? null : <Fact label="Activities" value={(o.activityLinks ?? []).map((l) => l.activity?.name).filter(Boolean).join(', ') || o.activity?.name || null} />}
          <Fact label="Raised by" value={o.raisedBy} />
          <Fact label="Approval comment" value={o.approvalComment ?? null} />
          <Fact label="Rejected because" value={o.rejectedReason} />
        </View>
      </Card>
      {o.relatedRecords ? <RelatedRecordsCard related={o.relatedRecords} onOpenActivity={(activityId) => router.push(`/activities/${activityId}` as never)} /> : null}
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

const RELATION_LABEL: Record<string, string> = {
  direct: 'Direct',
  activity_link: 'Activity link',
  via_allocation: 'Via a BOQ allocation',
}

/**
 * What the order reaches (PC-7b / R5-5), as the server composed it: one row
 * per activity — direct, through an activity link, or only through a BOQ
 * allocation (marked) — each opening the activity, and the BOQ items its
 * allocation links name. For a member who may not read the BOQ the server
 * leaves out the BOQ items and the allocation-only activities and says so
 * (`boqWithheld`): that reads "—" with its reason, every activity they may
 * see stays, and "None" is said only of an order that truly reaches nothing.
 */
function RelatedRecordsCard({ related, onOpenActivity }: { related: ChangeOrderRelatedRecords; onOpenActivity: (activityId: string) => void }) {
  const theme = useTheme()
  const withheld = related.boqWithheld ?? null
  const boqItems = withheld ? [] : (related.boqItems ?? [])
  return (
    <Card>
      <View style={styles.stack} testID="change-order-related">
        <Text variant="label" label tone="muted">
          Activities it reaches
        </Text>
        {related.activities.map((a) => (
          <Pressable key={a.id} accessibilityRole="button" onPress={() => onOpenActivity(a.id)} style={[styles.line, { borderColor: theme.colors.border }]} testID={`change-order-related-activity-${a.id}`}>
            <Text>{a.code ? `${a.code} · ${a.name ?? a.id}` : (a.name ?? a.id)}</Text>
            <Text variant="caption" tone="muted" testID={`change-order-related-activity-${a.id}-relation`}>
              {[RELATION_LABEL[a.relation] ?? a.relation, a.impactDays != null ? `${a.impactDays} d` : null].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        ))}
        {related.activities.length === 0 && !withheld ? (
          <Text tone="muted" testID="change-order-related-none">
            None
          </Text>
        ) : null}
        {withheld ? (
          <Text variant="caption" tone="muted" testID="change-order-related-withheld">
            {`— ${withheld.reason}`}
          </Text>
        ) : null}
        {boqItems.length > 0 ? (
          <View style={styles.stack} testID="change-order-related-boq">
            <Text variant="label" label tone="muted">
              BOQ items through its allocations
            </Text>
            {boqItems.map((b) => (
              <Text key={b.id} testID={`change-order-related-boq-${b.id}`}>
                {[b.code, b.description].filter(Boolean).join(' · ') || b.id}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  line: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs, gap: 2 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
})
