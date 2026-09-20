import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useNcrs, usePunchList } from '@/api/quality-hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, KPI, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

const CLOSED = /closed|verified|void/i

/**
 * Everything unresolved against quality on this project: non-conformances
 * first, because they hold work, then punch items by trade.
 *
 * The counts are the server's own — `NcrList.summary` and
 * `PunchList.summary`, including the `byTrade` breakdown the app has always
 * received and never shown. Nothing here is recounted on the device.
 */
export default function IssuesScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const ncrs = useNcrs(projectId)
  const punch = usePunchList(projectId, {})

  const ncrRows = useMemo(() => (ncrs.data?.rows ?? []).filter((n) => !CLOSED.test(n.status)), [ncrs.data])
  const punchRows = useMemo(() => (punch.data?.items ?? []).filter((p) => !CLOSED.test(p.status)), [punch.data])
  const byTrade = useMemo(() => Object.entries(punch.data?.summary.byTrade ?? {}).sort((a, b) => b[1] - a[1]), [punch.data])

  if (!projectId) {
    return (
      <Screen title="Issues" testID="screen-issues">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="Issues shows the open non-conformances and punch items on one project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen title="Issues" subtitle={project?.name} contentStyle={styles.content} testID="screen-issues">
      <ProjectSwitch project={project} />

      <View style={styles.kpis}>
        <KPI label="Open NCRs" value={ncrs.data ? String(ncrs.data.summary.open) : '—'} tone={(ncrs.data?.summary.open ?? 0) > 0 ? 'error' : 'default'} onPress={() => router.push('/quality/ncr')} />
        <KPI label="Major" value={ncrs.data ? String(ncrs.data.summary.major) : '—'} tone={(ncrs.data?.summary.major ?? 0) > 0 ? 'error' : 'default'} />
        <KPI label="Overdue" value={ncrs.data ? String(ncrs.data.summary.overdue) : '—'} tone={(ncrs.data?.summary.overdue ?? 0) > 0 ? 'warning' : 'default'} />
      </View>
      <View style={styles.kpis}>
        <KPI label="Open punch" value={punch.data ? String(punch.data.summary.open) : '—'} tone={(punch.data?.summary.open ?? 0) > 0 ? 'warning' : 'default'} onPress={() => router.push('/quality/punch')} />
        <KPI label="Punch overdue" value={punch.data ? String(punch.data.summary.overdue) : '—'} tone={(punch.data?.summary.overdue ?? 0) > 0 ? 'error' : 'default'} />
      </View>

      <View style={styles.group}>
        <Text variant="label" label tone="muted">
          Non-conformances
        </Text>
        {ncrs.isPending ? (
          <SkeletonList rows={3} />
        ) : ncrs.isError ? (
          <ErrorState message={userMessage(ncrs.error)} onRetry={() => void ncrs.refetch()} />
        ) : ncrRows.length === 0 ? (
          <Text tone="muted">No open non-conformances.</Text>
        ) : (
          ncrRows.slice(0, 8).map((n) => (
            <RecordRow
              key={n.id}
              reference={n.ref}
              title={n.description ?? 'Non-conformance'}
              status={n.status}
              meta={[humanise(n.severity), n.assigneeCompany?.name ?? n.assigneeUser?.name, n.dueDate ? `due ${day(n.dueDate)}` : null].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push(`/quality/ncr/${n.id}` as never)}
              testID={`issues-ncr-${n.id}`}
            />
          ))
        )}
        <Freshness updatedAt={ncrs.dataUpdatedAt || undefined} isFetching={ncrs.isFetching} />
      </View>

      <View style={styles.group}>
        <Text variant="label" label tone="muted">
          Punch items
        </Text>
        {byTrade.length > 0 ? (
          <Text variant="caption" tone="muted" testID="issues-by-trade">
            {byTrade.slice(0, 5).map(([trade, count]) => `${humanise(trade)} ${count}`).join(' · ')}
          </Text>
        ) : null}
        {punch.isPending ? (
          <SkeletonList rows={3} />
        ) : punch.isError ? (
          <ErrorState message={userMessage(punch.error)} onRetry={() => void punch.refetch()} />
        ) : punchRows.length === 0 ? (
          <Text tone="muted">No open punch items.</Text>
        ) : (
          punchRows.slice(0, 8).map((p) => (
            <RecordRow
              key={p.id}
              reference={p.ref}
              title={p.title}
              status={p.status}
              meta={[p.trade, p.location?.name ?? p.locationText, p.dueDate ? `due ${day(p.dueDate)}` : null].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push(`/quality/punch/${p.id}` as never)}
              testID={`issues-punch-${p.id}`}
            />
          ))
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  group: { gap: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
