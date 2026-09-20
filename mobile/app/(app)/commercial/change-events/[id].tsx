import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useChangeEvent } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { Comments } from '@/components/Comments'
import { History } from '@/components/History'
import { Evidence } from '@/components/Evidence'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { appRouteForRecord, openOnWeb, webPathForTarget } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money } from '@/utilities/format'

/** One change event: the estimate and what it rests on, the quotes out, and where it went. Pricing and conversion happen on the web. */
export default function ChangeEventScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const projects = useProjects()
  const event = useChangeEvent(projectId, id ?? null)
  const currency = projects.data?.find((p) => p.id === projectId)?.currency

  if (!projectId || !id) {
    return (
      <Screen testID="screen-change-event">
        <ErrorState message="Choose a project to open this change event." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (event.isPending) {
    return (
      <Screen testID="screen-change-event">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (event.isError) {
    return (
      <Screen testID="screen-change-event">
        <ErrorState message={userMessage(event.error)} onRetry={() => void event.refetch()} />
      </Screen>
    )
  }

  const e = event.data
  const sourceRoute = e.sourceRecordType && e.sourceRecordId ? appRouteForRecord(e.sourceRecordType, e.sourceRecordId) : null

  return (
    <Screen contentStyle={styles.content} testID="screen-change-event">
      <RecordHeader reference={e.ref} title={e.title} status={e.status} meta={[humanise(e.type), `From ${humanise(e.origin)}`, e.activity?.name, e.location?.name, e.ownerChange ? 'Owner-directed' : null].filter((v): v is string => !!v)} testID="change-event-header" />
      <View style={styles.kpis}>
        <KPI label="Rough order of magnitude" value={money(e.totals.rom, currency)} />
        <KPI label="Quoted" value={e.totals.quoted != null ? money(e.totals.quoted, currency) : '—'} />
        <KPI label="Estimate" value={money(e.totals.estimate, currency)} tone="warning" />
        <KPI label="Schedule impact" value={e.scheduleImpactDays != null ? `${e.scheduleImpactDays} d` : '—'} tone={e.scheduleImpactDays ? 'warning' : 'default'} />
      </View>
      <Card>
        <View style={styles.stack}>
          {e.description ? <Text>{e.description}</Text> : <Text tone="muted">No description.</Text>}
          <Fact label="Notes" value={e.notes} />
          {e.changeOrder ? (
            <View style={styles.row}>
              <Text variant="caption" tone="muted" style={styles.grow}>
                Converted to {e.changeOrder.ref} · {humanise(e.changeOrder.status)} · {money(e.changeOrder.value, currency)}
              </Text>
              <Button title="Open" variant="ghost" onPress={() => router.push(`/commercial/change-orders/${e.changeOrder!.id}`)} testID="change-event-open-order" />
            </View>
          ) : null}
          {e.sourceRecordType && e.sourceRecordId ? (
            <View style={styles.row}>
              <Text variant="caption" tone="muted" style={styles.grow}>
                Raised from {humanise(e.sourceRecordType)}
              </Text>
              <Button title="Open source" variant="ghost" onPress={() => (sourceRoute ? router.push(sourceRoute as never) : void openOnWeb(webPathForTarget({ projectId, module: 'commercial', recordType: e.sourceRecordType, recordId: e.sourceRecordId })))} />
            </View>
          ) : null}
          {e.voidReason ? <Fact label="Voided because" value={e.voidReason} /> : null}
        </View>
      </Card>
      <Card>
        <Evidence projectId={projectId!} recordType="change_event" recordId={e.id} recordRef={e.ref} locationId={e.locationId} canAdd={permissions.allows('change_event', 'update') || permissions.allows('change_event', 'create')} />
      </Card>

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Lines
          </Text>
          {(e.lines ?? []).length === 0 ? <Text tone="muted">No priced lines yet.</Text> : null}
          {(e.lines ?? []).map((l) => (
            <View key={l.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]} testID={`change-event-line-${l.id}`}>
              <View style={styles.grow}>
                <Text>{l.description}</Text>
                <Text variant="caption" tone="muted">
                  {[l.activity?.name, l.commitment ? `${l.commitment.ref} ${l.commitment.vendorName ?? ''}`.trim() : null, l.quantity && l.unit ? `${l.quantity} ${l.unit}` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text>{money(l.amount, currency)}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Quotes
          </Text>
          {(e.rfqs ?? []).length === 0 ? <Text tone="muted">No quotes requested. Requests go out from the web.</Text> : null}
          {(e.rfqs ?? []).map((r) => (
            <View key={r.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]} testID={`change-event-rfq-${r.id}`}>
              <View style={styles.grow}>
                <Text>{r.companyName}</Text>
                <Text variant="caption" tone="muted">
                  {[r.ref, r.dueDate ? `Due ${day(r.dueDate)}` : null, r.quoteLeadTimeDays != null ? `${r.quoteLeadTimeDays} d lead` : null, r.declinedReason].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={styles.right}>
                <Badge label={humanise(r.status)} tone={r.status === 'quoted' ? 'warning' : r.status === 'accepted' ? 'success' : 'neutral'} />
                {r.quoteTotal != null ? <Text>{money(r.quoteTotal, currency)}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      </Card>
      <Card>
        <Comments projectId={projectId} recordType="change_event" recordId={e.id} />
      </Card>
      <Card>
        <History projectId={projectId} entityType="change_event" entityId={e.id} />
      </Card>
      <Button title="Price, quote or convert on the web" variant="secondary" onPress={() => void openOnWeb(e.path)} testID="change-event-web" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  right: { alignItems: 'flex-end', gap: 2 },
})
