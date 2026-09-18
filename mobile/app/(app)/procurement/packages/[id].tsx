import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useProcurementOverview } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { openOnWeb, webPathForTarget } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

/** One package, from the overview since the server has no single-package route: its dates, its activity and its alerts. */
export default function PackageScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const overview = useProcurementOverview(projectId)
  const pkg = useMemo(() => overview.data?.packages.find((p) => p.id === id) ?? null, [overview.data, id])
  const orders = useMemo(() => (overview.data?.orders ?? []).filter((o) => o.packageId === id), [overview.data, id])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-package">
        <ErrorState message="Choose a project to open this package." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (overview.isPending) {
    return (
      <Screen testID="screen-package">
        <SkeletonList rows={5} />
      </Screen>
    )
  }
  if (overview.isError || !pkg) {
    return (
      <Screen testID="screen-package">
        <ErrorState message={overview.isError ? userMessage(overview.error) : 'This package is no longer available.'} onRetry={() => void overview.refetch()} />
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-package">
      <RecordHeader reference={pkg.packageNumber} title={pkg.title} status={pkg.status} meta={[pkg.supplier?.name, pkg.buyer ? `Buyer ${pkg.buyer}` : null].filter((v): v is string => !!v)} testID="package-header" />
      <Card>
        <View style={styles.stack}>
          {pkg.description ? <Text>{pkg.description}</Text> : null}
          <Fact label="Activity" value={pkg.activity ? `${pkg.activity.name}${pkg.activity.isCritical ? ' · critical' : ''}${pkg.activity.startDate ? ` · starts ${day(pkg.activity.startDate)}` : ''}` : null} />
          <Fact label="Required on site" value={pkg.requiredOnSiteDate ? day(pkg.requiredOnSiteDate) : null} />
          <Fact label="Latest order date" value={pkg.latestOrderDate ? day(pkg.latestOrderDate) : null} />
          <Fact label="Lead time" value={pkg.leadWeeks != null ? `${pkg.leadWeeks} week${pkg.leadWeeks === 1 ? '' : 's'}${pkg.bufferDays ? ` + ${pkg.bufferDays} d buffer` : ''}` : null} />
          <Fact label="Planned award" value={pkg.plannedAwardDate ? day(pkg.plannedAwardDate) : null} />
          <Fact label="Notes" value={pkg.notes} />
        </View>
      </Card>
      {(pkg.leadTimeAlerts ?? []).length ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Alerts
            </Text>
            {(pkg.leadTimeAlerts ?? []).map((a) => (
              <View key={a.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]}>
                <Badge label={humanise(a.severity)} tone={a.severity === 'high' ? 'error' : 'warning'} />
                <Text style={styles.grow}>{humanise(a.reason)}</Text>
                <Badge label={humanise(a.status)} tone={a.status === 'open' ? 'error' : 'neutral'} />
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      {orders.length ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Orders
            </Text>
            {orders.map((o) => (
              <View key={o.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]}>
                <Text style={styles.grow}>{[o.ref, o.supplier].filter(Boolean).join(' · ')}</Text>
                <Badge label={humanise(o.status)} tone="info" />
                <Button title="Open" variant="ghost" onPress={() => router.push(`/procurement/orders/${o.id}`)} testID={`package-order-${o.id}`} />
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Button title="Open on the web" variant="secondary" onPress={() => void openOnWeb(webPathForTarget({ projectId, module: 'procurement', child: 'packages', recordType: 'procurement_package', recordId: pkg.id }))} testID="package-web" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
})
