import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useQualityDashboard } from '@/api/quality-hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, KPI, SkeletonList, Text, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/**
 * Quality home: the score and what drives it, then the doors to
 * inspections, the punch list, observations, NCRs, safety and tests.
 * Every number comes from the server's dashboard; nothing is computed here.
 */
export default function QualityHomeScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const dashboard = useQualityDashboard(projectId)
  const project = projects.data?.find((p) => p.id === projectId) ?? null

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-quality">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const m = dashboard.data?.metrics
  const scoreTone = m?.qualityScore == null ? 'default' : m.qualityScore >= 80 ? 'success' : m.qualityScore >= 60 ? 'warning' : 'error'
  const doors = [
    { id: 'inspections', title: 'Inspections', route: '/quality/inspections', module: 'inspection' },
    { id: 'punch', title: 'Punch list', route: '/quality/punch', module: 'punch' },
    { id: 'observations', title: 'Observations', route: '/quality/punch?kind=observation', module: 'punch' },
    { id: 'ncr', title: 'NCRs', route: '/quality/ncr', module: 'ncr' },
    { id: 'safety', title: 'Safety', route: '/quality/safety', module: 'safety' },
    { id: 'tests', title: 'Material tests', route: '/quality/tests', module: 'inspection' },
  ].filter((d) => permissions.allows(d.module, 'read'))

  return (
    <Screen contentStyle={styles.content} testID="screen-quality">
      <ProjectSwitch project={project} />
      {dashboard.isPending ? (
        <SkeletonList rows={3} />
      ) : dashboard.isError ? (
        <ErrorState message={userMessage(dashboard.error)} onRetry={() => void dashboard.refetch()} />
      ) : m ? (
        <>
          <View style={styles.kpis}>
            <KPI label="Quality score" value={m.qualityScore != null ? String(m.qualityScore) : '—'} qualifier="of 100" tone={scoreTone} />
            <KPI label="Major NCRs" value={String(m.majorNcrs)} tone={m.majorNcrs > 0 ? 'error' : 'default'} onPress={() => router.push('/quality/ncr')} />
            <KPI label="Minor NCRs" value={String(m.minorNcrs)} tone={m.minorNcrs > 0 ? 'warning' : 'default'} onPress={() => router.push('/quality/ncr')} />
            <KPI label="Failed ITPs" value={String(m.failedItps)} tone={m.failedItps > 0 ? 'error' : 'default'} onPress={() => router.push('/quality/inspections')} />
            <KPI label="Open punch" value={String(m.openDefects)} onPress={() => router.push('/quality/punch')} />
            <KPI label="Observations" value={String(m.observationsOpen)} onPress={() => router.push('/quality/punch?kind=observation' as never)} />
            <KPI label="Tests" value={`${m.testsPassed} ✓ ${m.testsFailed} ✗`} tone={m.testsFailed > 0 ? 'warning' : 'default'} onPress={() => router.push('/quality/tests')} />
            <KPI label="Safety open" value={String(m.safetyOpen)} tone={m.safetyOpen > 0 ? 'warning' : 'default'} onPress={() => router.push('/quality/safety')} />
            <KPI label="Overdue" value={String(m.overdue)} tone={m.overdue > 0 ? 'error' : 'default'} />
          </View>
          <Text variant="caption" tone="muted">
            Score = 100 − major NCRs × 20 − minor NCRs × 8 − failed ITPs × 15, as the server computes it.
          </Text>
          <Freshness updatedAt={dashboard.dataUpdatedAt || undefined} isFetching={dashboard.isFetching} />
        </>
      ) : null}
      <View style={styles.doors} testID="quality-doors">
        {doors.map((d) => (
          <Button key={d.id} title={d.title} variant="secondary" onPress={() => router.push(d.route as never)} testID={`quality-${d.id}`} />
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  doors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
