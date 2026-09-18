import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useHealth, useProjects } from '@/api/hooks'
import { useActivitiesFull } from '@/api/site-hooks'
import type { Activity } from '@/api/site-types'
import { useAuthStore } from '@/auth/store'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { TimelineStrip } from '@/components/TimelineStrip'
import { Button, EmptyState, ErrorState, Input, KPI, RecordRow, SkeletonList, spacing } from '@/design-system'
import { useLayout } from '@/hooks/useLayout'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'
import { listPerformance } from '@/components/listProps'

type View_ = 'today' | 'mine' | 'critical' | 'milestones' | 'delayed' | 'all'

const withinToday = (a: Activity, now = Date.now()) => {
  const start = a.startDate ? new Date(a.startDate).getTime() : null
  const end = a.endDate ? new Date(a.endDate).getTime() : null
  return a.status === 'in_progress' || (start != null && end != null && start <= now && now <= end && a.status !== 'complete')
}

export function filterActivities(list: Activity[], view: View_, term: string, myId: string | null): Activity[] {
  const q = term.trim().toLowerCase()
  return list
    .filter((a) => {
      switch (view) {
        case 'today':
          return withinToday(a)
        case 'mine':
          return !!myId && a.assignedEngineers.some((e) => e.id === myId)
        case 'critical':
          return a.isCritical && a.status !== 'complete'
        case 'milestones':
          return a.isMilestone
        case 'delayed':
          return a.status === 'delayed'
        default:
          return true
      }
    })
    .filter((a) => !q || [a.name, a.activityCode, a.wbsCode].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

/**
 * Today's work first: what is in progress or due now, then mine, the
 * critical path, milestones and delays. Progress shown is what was approved;
 * a pending submission is marked, never counted.
 */
export default function ActivitiesScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user?.id ?? null)
  const projects = useProjects()
  const activities = useActivitiesFull(projectId)
  const health = useHealth(projectId)
  const [view, setView] = useState<View_>('today')
  const [term, setTerm] = useState('')
  const [timeline, setTimeline] = useState(false)
  const { isExpanded } = useLayout()
  const project = projects.data?.find((p) => p.id === projectId) ?? null

  const all = useMemo(() => activities.data ?? [], [activities.data])
  const rows = useMemo(() => filterActivities(all, view, term, me), [all, view, term, me])
  const counts = useMemo(() => ({ critical: all.filter((a) => a.isCritical && a.status !== 'complete').length, delayed: all.filter((a) => a.status === 'delayed').length, milestones: all.filter((a) => a.isMilestone).length }), [all])
  const schedule = health.data?.dimensions.find((d) => d.key === 'schedule')

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-activities">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-activities">
      <FlatList {...listPerformance}
        data={timeline && isExpanded ? [] : rows}
        keyExtractor={(a) => a.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ProjectSwitch project={project} />
            <View style={styles.kpis}>
              <KPI label="Schedule health" value={schedule?.score != null ? String(schedule.score) : '—'} tone={schedule?.score != null ? (schedule.score >= 80 ? 'success' : schedule.score >= 60 ? 'warning' : 'error') : 'default'} />
              <KPI label="Critical" value={String(counts.critical)} onPress={() => setView('critical')} />
              <KPI label="Delayed" value={String(counts.delayed)} tone={counts.delayed > 0 ? 'error' : 'default'} onPress={() => setView('delayed')} />
            </View>
            <Input label="Find" placeholder="Code, name or WBS" value={term} onChangeText={setTerm} autoCapitalize="none" returnKeyType="search" testID="activities-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="Today's work" selected={view === 'today'} onPress={() => setView('today')} testID="activities-chip-today" />
              <FilterChip label="Mine" selected={view === 'mine'} onPress={() => setView('mine')} testID="activities-chip-mine" />
              <FilterChip label="Critical" count={counts.critical} selected={view === 'critical'} onPress={() => setView('critical')} testID="activities-chip-critical" />
              <FilterChip label="Milestones" count={counts.milestones} selected={view === 'milestones'} onPress={() => setView('milestones')} testID="activities-chip-milestones" />
              <FilterChip label="Delayed" count={counts.delayed} selected={view === 'delayed'} onPress={() => setView('delayed')} testID="activities-chip-delayed" />
              <FilterChip label="All" count={all.length} selected={view === 'all'} onPress={() => setView('all')} testID="activities-chip-all" />
              {isExpanded ? <FilterChip label="Timeline" selected={timeline} onPress={() => setTimeline(!timeline)} testID="activities-chip-timeline" /> : null}
            </ScrollView>
            <View style={styles.row}>
              <Freshness updatedAt={activities.dataUpdatedAt || undefined} isFetching={activities.isFetching} />
              <Button title="Lookahead" variant="ghost" onPress={() => router.push('/activities/lookahead')} testID="activities-lookahead" />
            </View>
            {timeline && isExpanded ? <TimelineStrip activities={rows} onOpen={(id) => router.push(`/activities/${id}`)} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.activityCode ?? item.wbsCode ?? 'Activity'}
            title={item.name}
            status={item.status}
            meta={[item.wbsCode, item.startDate && item.endDate ? `${day(item.startDate)} → ${day(item.endDate)}` : null, item.isCritical ? 'Critical' : item.totalFloat != null ? `Float ${item.totalFloat} d` : null, item.isMilestone ? 'Milestone' : null].filter(Boolean).join(' · ')}
            trailing={item.pctComplete != null ? `${Math.round(item.pctComplete)}%${item.pendingProgress ? ' · pending' : ''}` : item.pendingProgress ? 'pending' : undefined}
            trailingTone={item.pendingProgress ? 'warning' : 'muted'}
            onPress={() => router.push(`/activities/${item.id}`)}
            testID={`activity-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          activities.isPending ? (
            <SkeletonList rows={5} />
          ) : activities.isError ? (
            <ErrorState message={userMessage(activities.error)} onRetry={() => void activities.refetch()} />
          ) : (
            <EmptyState title={view === 'today' ? 'Nothing is in progress today' : view === 'mine' ? 'No activity is assigned to you' : `No ${humanise(view).toLowerCase()} activities`} body={view === 'today' ? 'Try Mine or All.' : undefined} />
          )
        }
        onRefresh={() => void activities.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
