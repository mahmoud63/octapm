import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useActivitiesFull } from '@/api/site-hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, KPI, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

/**
 * Progress: what is waiting to be approved, and what is behind.
 *
 * The planning engineer's fourth slot. Both lists are derived from the
 * activity register the app already reads — `pendingProgress` is carried on
 * every row — so this needs no endpoint of its own. Whether the person may
 * actually approve is decided on the activity, by the server.
 */
export default function ProgressScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const activities = useActivitiesFull(projectId)
  const permissions = usePermissions(projectId)
  const mayReview = permissions.allowsTransition('progress', 'submission.approve')

  const rows = useMemo(() => activities.data ?? [], [activities.data])
  const pending = useMemo(() => rows.filter((a) => !!a.pendingProgress), [rows])
  const behind = useMemo(() => rows.filter((a) => a.status === 'delayed'), [rows])

  if (!projectId) {
    return (
      <Screen title="Progress" testID="screen-progress">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="Progress is shown for one project at a time." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen title="Progress" subtitle={project?.name} contentStyle={styles.content} testID="screen-progress">
      <ProjectSwitch project={project} />
      <View style={styles.kpis}>
        <KPI label="Awaiting approval" value={activities.data ? String(pending.length) : '—'} tone={pending.length > 0 ? 'warning' : 'default'} />
        <KPI label="Behind" value={activities.data ? String(behind.length) : '—'} tone={behind.length > 0 ? 'error' : 'default'} />
        <KPI label="Activities" value={activities.data ? String(rows.length) : '—'} onPress={() => router.push('/activities')} />
      </View>

      <View style={styles.group}>
        <Text variant="label" label tone="muted">
          Awaiting approval
        </Text>
        {!mayReview ? (
          <Text variant="caption" tone="muted">
            You can see what has been submitted; approving it is done by the planning team.
          </Text>
        ) : null}
        {activities.isPending ? (
          <SkeletonList rows={3} />
        ) : activities.isError ? (
          <ErrorState message={userMessage(activities.error)} onRetry={() => void activities.refetch()} />
        ) : pending.length === 0 ? (
          <Text tone="muted">Nothing is waiting for approval.</Text>
        ) : (
          pending.slice(0, 15).map((a) => (
            <RecordRow
              key={a.id}
              reference={a.activityCode ?? a.wbsCode ?? 'Activity'}
              title={a.name}
              status={a.pendingProgress?.status ?? 'submitted'}
              meta={[a.pendingProgress?.pctComplete != null ? `${Math.round(a.pendingProgress.pctComplete)}% submitted` : null, a.pendingProgress?.submittedAt ? day(a.pendingProgress.submittedAt) : null].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push(`/activities/${a.id}` as never)}
              testID={`progress-pending-${a.id}`}
            />
          ))
        )}
        <Freshness updatedAt={activities.dataUpdatedAt || undefined} isFetching={activities.isFetching} />
      </View>

      {behind.length > 0 ? (
        <View style={styles.group}>
          <Text variant="label" label tone="muted">
            Behind
          </Text>
          {behind.slice(0, 10).map((a) => (
            <RecordRow
              key={a.id}
              reference={a.activityCode ?? a.wbsCode ?? 'Activity'}
              title={a.name}
              status={a.status}
              meta={[a.pctComplete != null ? `${Math.round(a.pctComplete)}%` : null, a.isCritical ? 'Critical path' : null, humanise(a.category)].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push(`/activities/${a.id}` as never)}
              testID={`progress-behind-${a.id}`}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  group: { gap: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
