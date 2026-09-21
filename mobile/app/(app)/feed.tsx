import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useTimeline } from '@/api/record-hooks'
import type { AuditEvent } from '@/api/record-types'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Card, EmptyState, ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { appRouteForRecord } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { humanise, relative } from '@/utilities/format'

/** What the record calls itself, in the words a person would recognise. */
const nameOf = (event: AuditEvent) => {
  const s = event.summary
  return s?.ref ?? s?.receiptNumber ?? s?.subject ?? s?.title ?? s?.name ?? s?.date ?? humanise(event.recordType ?? event.entityType)
}

/**
 * Everything that happened on this project, newest first.
 *
 * The server keeps one audit across every record, so this is one call and not
 * a dozen stitched together. A row says who did what to which record and when
 * — never an identifier: a reference is what gets said out loud on site, and a
 * UUID tells a person nothing they can act on.
 *
 * There is no "load more". The server's cursor only applies when a single
 * source is asked for, so a second page would quietly return the first one
 * again; fifty events is what this honestly offers.
 */
export default function ProjectFeedScreen() {
  const theme = useTheme()
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const timeline = useTimeline(projectId)

  if (!projectId) {
    return (
      <Screen title="Activity" testID="screen-feed">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="A timeline belongs to one project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const open = (event: AuditEvent) => {
    const route = appRouteForRecord(event.recordType ?? event.entityType, event.recordId ?? event.entityId)
    if (route) router.push(route as never)
  }

  return (
    <Screen title="Activity" subtitle={project?.name} contentStyle={styles.content} testID="screen-feed">
      <ProjectSwitch project={project} />

      {timeline.isPending ? (
        <SkeletonList rows={8} />
      ) : timeline.isError ? (
        <ErrorState message={userMessage(timeline.error)} onRetry={() => void timeline.refetch()} />
      ) : (timeline.data ?? []).length === 0 ? (
        <EmptyState title="Nothing has happened yet" body="Every record raised, answered or closed on this project appears here." />
      ) : (
        <Card testID="feed-list">
          <View style={styles.stack}>
            {(timeline.data ?? []).map((event) => (
              <View key={event.id} style={[styles.event, { borderColor: theme.colors.border }]} testID={`feed-event-${event.id}`}>
                <Text onPress={() => open(event)} accessibilityRole="button">
                  <Text style={styles.strong}>{nameOf(event)}</Text>
                  {` ${humanise(event.action).toLowerCase()}`}
                  {event.toStatus ? ` — ${humanise(event.toStatus).toLowerCase()}` : ''}
                </Text>
                <Text variant="caption" tone="muted">
                  {[event.actorName ?? (event.actorRole ? humanise(event.actorRole) : null), humanise(event.recordType ?? event.entityType), relative(event.occurredAt)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      )}
      <Freshness updatedAt={timeline.dataUpdatedAt || undefined} isFetching={timeline.isFetching} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  event: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  strong: { fontFamily: 'Inter_600SemiBold' },
})
