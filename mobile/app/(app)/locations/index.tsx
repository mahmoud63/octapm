import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useLocations } from '@/api/record-hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

/**
 * Where the work is, as the project actually describes it.
 *
 * A location can be a site, a building, a level, a zone, a room, an area or
 * something external, and it can sit under another one — but only as far as a
 * given project has bothered to model. So this walks whatever tree exists
 * rather than insisting on building → level → zone: a project that keeps one
 * flat list of zones gets one flat list, without empty headings implying a
 * structure nobody set up.
 */
export default function LocationsScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const locations = useLocations(projectId)
  const [parentId, setParentId] = useState<string | null>(null)

  const all = useMemo(() => locations.data ?? [], [locations.data])
  const here = useMemo(() => all.filter((l) => l.parentId === parentId), [all, parentId])
  const current = useMemo(() => (parentId ? (all.find((l) => l.id === parentId) ?? null) : null), [all, parentId])

  if (!projectId) {
    return (
      <Screen title="Locations" testID="screen-locations">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="Locations belong to one project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen title="Locations" subtitle={current?.fullName ?? project?.name} contentStyle={styles.content} testID="screen-locations">
      <ProjectSwitch project={project} />

      {current ? (
        <View style={styles.crumbs}>
          <Button title="‹ Back" variant="ghost" onPress={() => setParentId(current.parentId)} testID="locations-up" />
          <Text tone="muted" numberOfLines={1} style={styles.grow} testID="locations-here">
            {current.fullName}
          </Text>
          <Button title="Open" variant="secondary" onPress={() => router.push(`/locations/${current.id}`)} testID="locations-open-current" />
        </View>
      ) : null}

      {locations.isPending ? (
        <SkeletonList rows={5} />
      ) : locations.isError ? (
        <ErrorState message={userMessage(locations.error)} onRetry={() => void locations.refetch()} />
      ) : here.length === 0 ? (
        <EmptyState
          title={current ? 'Nothing inside this one' : 'No locations yet'}
          body={current ? 'Open it to see what has been recorded here.' : 'A project describes its own places — buildings, levels, zones. None have been set up for this one.'}
          action={current ? { title: 'Open this location', onPress: () => router.push(`/locations/${current.id}`) } : undefined}
        />
      ) : (
        here.map((location) => (
          <RecordRow
            key={location.id}
            reference={location.code ?? humanise(location.kind ?? 'area')}
            title={location.name}
            meta={[location.kind ? humanise(location.kind) : null, location.childCount ? `${location.childCount} inside` : null].filter(Boolean).join(' · ')}
            trailing={location.childCount ? '›' : undefined}
            trailingTone="muted"
            // Somewhere with places inside it opens up; somewhere without is a
            // destination, so it goes straight to what has happened there.
            onPress={() => (location.childCount ? setParentId(location.id) : router.push(`/locations/${location.id}`))}
            testID={`location-row-${location.id}`}
          />
        ))
      )}
      <Freshness updatedAt={locations.dataUpdatedAt || undefined} isFetching={locations.isFetching} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
})
