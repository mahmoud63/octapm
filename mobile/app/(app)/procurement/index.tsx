import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useAlertActions, useProcurementOverview } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, EmptyState, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/** Procurement home: the counts, the lead-time alerts to acknowledge, and the doors to packages, orders and long lead. */
export default function ProcurementHomeScreen() {
  const theme = useTheme()
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const overview = useProcurementOverview(projectId)
  const actions = useAlertActions(projectId ?? '')
  const [failure, setFailure] = useState<string | null>(null)
  const project = projects.data?.find((p) => p.id === projectId) ?? null

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-procurement">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const o = overview.data
  const canAcknowledge = permissions.allowsTransition('procurement', 'alert.acknowledge')
  const packageOf = (id: string | null) => o?.packages.find((p) => p.id === id) ?? null
  const orderOf = (id: string | null) => o?.orders.find((p) => p.id === id) ?? null

  const acknowledge = async (alertId: string) => {
    setFailure(null)
    try {
      await actions.acknowledge.mutateAsync(alertId)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-procurement">
      <ProjectSwitch project={project} />
      {overview.isPending ? (
        <SkeletonList rows={3} />
      ) : overview.isError ? (
        <ErrorState message={userMessage(overview.error)} onRetry={() => void overview.refetch()} />
      ) : o ? (
        <>
          <View style={styles.kpis}>
            <KPI label="Packages" value={String(o.summary.packages)} onPress={() => router.push('/procurement/packages')} />
            <KPI label="Purchase orders" value={String(o.summary.purchaseOrders)} onPress={() => router.push('/procurement/orders')} />
            <KPI label="Suppliers" value={String(o.summary.suppliers)} />
            <KPI label="Open alerts" value={String(o.summary.openAlerts)} tone={o.summary.openAlerts > 0 ? 'error' : 'default'} />
          </View>
          <Card>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Lead-time alerts
              </Text>
              {o.alerts.length === 0 ? <Text tone="muted">Nothing at risk.</Text> : null}
              {o.alerts.map((a) => {
                const pkg = packageOf(a.packageId)
                const order = orderOf(a.orderId)
                return (
                  <View key={a.id} style={[styles.alert, { borderColor: theme.colors.border }]} testID={`alert-${a.id}`}>
                    <View style={styles.row}>
                      <Badge label={humanise(a.severity)} tone={a.severity === 'high' ? 'error' : a.severity === 'medium' ? 'warning' : 'info'} />
                      <Text style={styles.grow}>{humanise(a.reason)}</Text>
                      <Badge label={humanise(a.status)} tone={a.status === 'open' ? 'error' : a.status === 'acknowledged' ? 'warning' : 'success'} />
                    </View>
                    <Text variant="caption" tone="muted">
                      {[pkg ? `${pkg.packageNumber} ${pkg.title}` : null, order ? order.ref : null, a.needDate ? `Needed ${day(a.needDate)}` : null, a.orderByDate ? `Order by ${day(a.orderByDate)}` : null, a.daysAtRisk ? `${a.daysAtRisk} d at risk` : null].filter(Boolean).join(' · ')}
                    </Text>
                    {a.status === 'open' && canAcknowledge ? <Button title="Acknowledge" variant="secondary" loading={actions.acknowledge.isPending && actions.acknowledge.variables === a.id} onPress={() => void acknowledge(a.id)} testID={`alert-acknowledge-${a.id}`} /> : null}
                  </View>
                )
              })}
            </View>
          </Card>
          <Freshness updatedAt={overview.dataUpdatedAt || undefined} isFetching={overview.isFetching} />
        </>
      ) : null}
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="procurement-failure">
          {failure}
        </Text>
      ) : null}
      <View style={styles.doors} testID="procurement-doors">
        <Button title="Packages" variant="secondary" onPress={() => router.push('/procurement/packages')} testID="procurement-packages" />
        <Button title="Purchase orders" variant="secondary" onPress={() => router.push('/procurement/orders')} testID="procurement-orders" />
        <Button title="Long lead" variant="secondary" onPress={() => router.push('/procurement/long-lead')} testID="procurement-long-lead" />
      </View>
      <Text variant="caption" tone="muted">
        Orders are raised, submitted, approved and issued on the web or through your approvals; deliveries are received under Inventory.
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1 },
  alert: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  doors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
