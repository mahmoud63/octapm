import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects, useWorkspace } from '@/api/hooks'
import type { Project } from '@/api/types'
import { Freshness } from '@/components/Freshness'
import { healthTone } from '@/components/HealthDimensions'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Input, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { listPerformance } from '@/components/listProps'

const trailingTone = { success: 'default', warning: 'warning', error: 'error', muted: 'muted' } as const

/**
 * Every project the person can open. Choosing one makes it the project for
 * the whole app; the previous project's cached records are dropped first.
 */
export default function ProjectsScreen() {
  const router = useRouter()
  const projects = useProjects()
  const workspace = useWorkspace()
  const current = useProjectStore((s) => s.currentProjectId)
  const select = useProjectStore((s) => s.select)
  const [filter, setFilter] = useState('')

  const scores = useMemo(() => new Map((workspace.data?.projectHealth ?? []).map((row) => [row.id, row.overallScore])), [workspace.data])
  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const list = projects.data ?? []
    return term ? list.filter((p) => [p.name, p.contractNumber, p.location, p.clientName].some((v) => v?.toLowerCase().includes(term))) : list
  }, [projects.data, filter])

  const choose = async (project: Project) => {
    await select(project.id)
    router.replace('/')
  }

  return (
    <Screen title="Projects" subtitle={projects.data ? `${projects.data.length} project${projects.data.length === 1 ? '' : 's'}` : undefined} scroll={false} testID="screen-projects">
      <FlatList {...listPerformance}
        data={rows}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Input label="Find a project" placeholder="Name, contract number, location" value={filter} onChangeText={setFilter} autoCapitalize="none" returnKeyType="search" testID="projects-filter" />
            <Freshness updatedAt={projects.dataUpdatedAt || undefined} isFetching={projects.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const score = scores.get(item.id) ?? null
          return (
            <RecordRow
              reference={item.contractNumber ?? item.type ?? 'Project'}
              title={item.name}
              status={item.status}
              meta={[item.location, item.clientName].filter(Boolean).join(' · ') || undefined}
              trailing={score != null ? `Health ${score}` : undefined}
              trailingTone={trailingTone[healthTone(score)]}
              selected={item.id === current}
              onPress={() => void choose(item)}
              testID={`project-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          projects.isPending ? (
            <SkeletonList rows={4} />
          ) : projects.isError ? (
            <ErrorState message={userMessage(projects.error)} onRetry={() => void projects.refetch()} />
          ) : filter ? (
            <EmptyState title="No project matches" body="Try a shorter word, or the contract number." />
          ) : (
            <EmptyState title="You are not on any project yet" body="Ask your project manager to add you to a project on the OctaPM web platform." />
          )
        }
        ListFooterComponent={
          current ? (
            <Text variant="caption" tone="muted" style={styles.footer}>
              The highlighted project is the one you are working in.
            </Text>
          ) : null
        }
        onRefresh={() => void Promise.all([projects.refetch(), workspace.refetch()])}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, paddingBottom: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
  footer: { paddingTop: spacing.md },
})
