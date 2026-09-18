import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useAssignments, useHealth, useNotificationSummary, useProjects } from '@/api/hooks'
import type { AssignmentItem } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { AssignmentRow } from '@/components/AssignmentRow'
import { Freshness } from '@/components/Freshness'
import { HealthDimensions, healthTone } from '@/components/HealthDimensions'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, EmptyState, ErrorState, KPI, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { availableQuickActions } from '@/home/quick-actions'
import { destinationForTarget, openOnWeb } from '@/navigation/links'
import { roleLabel } from '@/permissions/policy'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { relative } from '@/utilities/format'

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const dueToday = (item: AssignmentItem, now = new Date()) => !!item.dueDate && sameDay(new Date(item.dueDate), now)
const kpiTone = (score: number | null | undefined) => {
  const tone = healthTone(score)
  return tone === 'muted' ? 'default' : tone
}

/**
 * Home: the field control centre.
 *
 * What needs you comes first, then what is due today, then how the project
 * is doing and what has happened. Everything on this screen belongs to one
 * project, named at the top, and switching it clears the screen.
 */
export default function HomeScreen() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const projectId = useProjectStore((s) => s.currentProjectId)
  const hydrated = useProjectStore((s) => s.hydrated)
  const select = useProjectStore((s) => s.select)

  const projects = useProjects()
  const assignments = useAssignments(projectId)
  const health = useHealth(projectId)
  const notifications = useNotificationSummary()
  const permissions = usePermissions(projectId)
  const [refreshing, setRefreshing] = useState(false)

  const project = projects.data?.find((p) => p.id === projectId) ?? null

  // One project: no need to ask. A project that is no longer listed (access
  // removed) is dropped, and with it everything cached about it.
  useEffect(() => {
    if (!hydrated || !projects.isSuccess) return
    const list = projects.data
    if (!projectId && list.length === 1) void select(list[0]!.id)
    else if (projectId && list.length > 0 && !list.some((p) => p.id === projectId)) void select(null)
  }, [hydrated, projectId, projects.isSuccess, projects.data, select])

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([projects.refetch(), assignments.refetch(), health.refetch(), notifications.refetch(), permissions.refetch()])
    setRefreshing(false)
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] ?? ''

  const items = assignments.data?.items ?? []
  const today = items.filter((item) => item.overdue || dueToday(item))
  const quickActions = availableQuickActions(permissions.matrix)
  const open = (item: AssignmentItem) => {
    const destination = destinationForTarget(item.target)
    if ('app' in destination) router.push(destination.app as never)
    else void openOnWeb(destination.web)
  }
  const records = [
    { id: 'site', title: 'Daily log', route: '/site', module: 'progress' },
    { id: 'activities', title: 'Activities', route: '/activities', module: 'schedule' },
    { id: 'photos', title: 'Photos', route: '/photos', module: 'document_control' },
    { id: 'quality', title: 'Quality', route: '/quality', module: 'punch' },
    { id: 'rfi', title: 'RFIs', route: '/rfi', module: 'rfi' },
    { id: 'tasks', title: 'Tasks', route: '/tasks', module: 'task' },
    { id: 'documents', title: 'Documents', route: '/documents', module: 'document_control' },
    { id: 'drawings', title: 'Drawings', route: '/drawings', module: 'document_control' },
    { id: 'timesheets', title: 'Timesheets', route: '/timesheets', module: 'timesheet' },
  ].filter((r) => permissions.allows(r.module, 'read'))

  return (
    <Screen
      title={`${greeting}${firstName ? `, ${firstName}` : ''}`}
      subtitle={roleLabel(user?.role)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      testID="screen-home"
    >
      <ProjectSwitch project={project} />

      {!projectId ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Choose a project
            </Text>
            {projects.isPending ? (
              <SkeletonList rows={3} />
            ) : projects.isError ? (
              <ErrorState message={userMessage(projects.error)} onRetry={() => void projects.refetch()} />
            ) : projects.data.length === 0 ? (
              <EmptyState title="You are not on any project yet" body="Ask your project manager to add you to a project on the OctaPM web platform." />
            ) : (
              projects.data.slice(0, 5).map((p) => (
                <RecordRow key={p.id} reference={p.contractNumber ?? p.type ?? 'Project'} title={p.name} status={p.status} meta={p.location ?? undefined} onPress={() => void select(p.id)} testID={`choose-${p.id}`} />
              ))
            )}
            {projects.data && projects.data.length > 5 ? <Button title="All projects" variant="secondary" onPress={() => router.push('/projects')} /> : null}
          </View>
        </Card>
      ) : null}

      {quickActions.length > 0 ? (
        <View style={styles.actions} testID="quick-actions">
          {quickActions.map((action) => (
            <Button key={action.id} title={action.title} variant="secondary" onPress={() => router.push(action.route as never)} testID={`quick-${action.id}`} />
          ))}
        </View>
      ) : null}

      {projectId && records.length > 0 ? (
        <View style={styles.actions} testID="records">
          {records.map((r) => (
            <Button key={r.id} title={r.title} variant="secondary" onPress={() => router.push(r.route as never)} testID={`records-${r.id}`} />
          ))}
        </View>
      ) : null}

      {projectId ? (
        <>
          <Card>
            <View style={styles.stack}>
              <View style={styles.cardHeader}>
                <Text variant="label" label tone="muted">
                  Needs You
                </Text>
                {assignments.data ? <Badge label={String(assignments.data.summary.total)} tone={assignments.data.summary.overdue > 0 ? 'error' : assignments.data.summary.total > 0 ? 'warning' : 'neutral'} /> : null}
                <View style={styles.grow} />
                <Pressable accessibilityRole="link" onPress={() => router.push('/needs-you')} hitSlop={8} testID="home-needs-you-all">
                  <Text tone="link">See all</Text>
                </Pressable>
              </View>
              {assignments.isPending ? (
                <SkeletonList rows={3} />
              ) : assignments.isError ? (
                <ErrorState message={userMessage(assignments.error)} onRetry={() => void assignments.refetch()} />
              ) : items.length === 0 ? (
                <EmptyState title="Nothing is waiting on you right now" body="When a record needs your answer, approval or action, it appears here first." style={styles.empty} />
              ) : (
                items.slice(0, 3).map((item) => <AssignmentRow key={`${item.recordType}:${item.recordId}`} item={item} onPress={() => open(item)} />)
              )}
              <Freshness updatedAt={assignments.dataUpdatedAt || undefined} isFetching={assignments.isFetching && !refreshing} />
            </View>
          </Card>

          <Card>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Today
              </Text>
              <View style={styles.kpis}>
                <KPI label="Overdue" value={String(assignments.data?.summary.overdue ?? '—')} tone={(assignments.data?.summary.overdue ?? 0) > 0 ? 'error' : 'default'} />
                <KPI label="Due today" value={String(items.filter((item) => dueToday(item)).length)} tone={items.some((item) => dueToday(item)) ? 'warning' : 'default'} />
                <KPI label="Ball in court" value={String(assignments.data?.summary.ballInCourt ?? '—')} />
              </View>
              {today.length > 0 ? (
                today.slice(0, 3).map((item) => <AssignmentRow key={`today:${item.recordType}:${item.recordId}`} item={item} onPress={() => open(item)} />)
              ) : assignments.data ? (
                <Text tone="muted">Nothing is due today.</Text>
              ) : null}
            </View>
          </Card>

          <Card>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Project health
              </Text>
              {health.isPending ? (
                <SkeletonList rows={2} />
              ) : health.isError ? (
                <ErrorState message={userMessage(health.error)} onRetry={() => void health.refetch()} />
              ) : (
                <>
                  <View style={styles.kpis}>
                    <KPI label="Overall" value={health.data.overallScore != null ? String(health.data.overallScore) : '—'} qualifier="of 100" tone={kpiTone(health.data.overallScore)} />
                  </View>
                  <HealthDimensions dimensions={health.data.dimensions} />
                  {health.data.pendingReview.total > 0 ? (
                    <Text variant="caption" tone="muted">
                      {health.data.pendingReview.total} item{health.data.pendingReview.total === 1 ? '' : 's'} awaiting review are not counted in these scores.
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          </Card>
        </>
      ) : null}

      <Card onPress={() => router.push('/notifications')} testID="home-notifications">
        <View style={styles.stack}>
          <View style={styles.cardHeader}>
            <Text variant="label" label tone="muted">
              Notifications
            </Text>
            {notifications.data ? <Badge label={`${notifications.data.unread} unread`} tone={notifications.data.unread > 0 ? 'info' : 'neutral'} /> : null}
          </View>
          {notifications.data?.recent.slice(0, 3).map((n) => (
            <View key={n.id} style={styles.notification}>
              <Text numberOfLines={1} style={n.status === 'unread' ? styles.unread : undefined}>
                {n.title}
              </Text>
              <Text variant="caption" tone="muted">
                {relative(n.createdAt)}
              </Text>
            </View>
          ))}
          {notifications.data && notifications.data.recent.length === 0 ? <Text tone="muted">No notifications yet.</Text> : null}
        </View>
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  grow: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  empty: { paddingVertical: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notification: { gap: 2, paddingVertical: spacing.xs },
  unread: { fontFamily: 'Inter_600SemiBold' },
})
