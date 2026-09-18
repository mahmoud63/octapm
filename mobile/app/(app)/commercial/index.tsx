import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useChangeEvents, useMySteps } from '@/api/commercial-hooks'
import { useProjects } from '@/api/hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, KPI, Text, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/**
 * Commercial home: what the change events add up to, the approvals waiting
 * on this person, and the doors this role may open. Approving, certifying
 * and paying stay on the web; the app reads, raises and submits.
 */
export default function CommercialHomeScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const events = useChangeEvents(projectId)
  const steps = useMySteps()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const waiting = (steps.data ?? []).filter((s) => s.projectId === projectId).length

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-commercial">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const s = events.data?.summary
  const doors = [
    { id: 'change-events', title: 'Change events', route: '/commercial/change-events', module: 'change_event' },
    { id: 'change-orders', title: 'Change orders', route: '/commercial/change-orders', module: 'change_order' },
    { id: 'commitments', title: 'Commitments', route: '/commercial/commitments', module: 'commitment' },
    { id: 'pay-apps', title: 'Pay applications', route: '/commercial/pay-apps', module: 'sub_pay_app' },
  ].filter((d) => permissions.allows(d.module, 'read'))

  return (
    <Screen contentStyle={styles.content} testID="screen-commercial">
      <ProjectSwitch project={project} />
      {permissions.allows('workflow', 'read') ? <KPI label="Approvals waiting on you" value={String(waiting)} tone={waiting > 0 ? 'warning' : 'default'} onPress={() => router.push('/workflow')} /> : null}
      {s ? (
        <View style={styles.kpis}>
          <KPI label="Open change events" value={String((s.byStatus.open ?? 0) + (s.byStatus.pricing ?? 0) + (s.byStatus.priced ?? 0))} onPress={() => router.push('/commercial/change-events')} />
          <KPI label="Quotes waiting" value={String(s.quotesWaiting)} tone={s.quotesWaiting > 0 ? 'warning' : 'default'} />
          <KPI label="Rough order of magnitude" value={money(s.romTotal, project?.currency)} />
          <KPI label="Converted value" value={money(s.convertedValue, project?.currency)} />
        </View>
      ) : null}
      <Freshness updatedAt={events.dataUpdatedAt || undefined} isFetching={events.isFetching} />
      <View style={styles.doors} testID="commercial-doors">
        {doors.map((d) => (
          <Button key={d.id} title={d.title} variant="secondary" onPress={() => router.push(d.route as never)} testID={`commercial-${d.id}`} />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        Change orders, commitments and pay applications are read here and decided on the web or through your approvals. Nothing on this phone approves, certifies or pays.
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  doors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
